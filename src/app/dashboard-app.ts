import { deleteCardStore, openCardStore, type IdbCardStore } from '../cache/idb-store';
import { createSdkChartRepository } from '../charts/chart-repository';
import type { ChartSpec } from '../charts/chart-spec';
import type { CardRecord } from '../domain/card';
import type { PipefyAppGlobal, PipefyClient } from '../pipefy/sdk';
import { createSdkClient, retrying } from '../sync/graphql-client';
import { createPipefyApi } from '../sync/pipefy-api';
import { SessionChangedError, SyncEngine, type SyncProgress, type SyncResult } from '../sync/sync-engine';
import { DashboardView } from '../ui/dashboard-view';

/** Espera antes de sincronizar depois de um evento de card (junta rajadas). */
const LIVE_SYNC_DELAY_MS = 2000;

const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
const integer = new Intl.NumberFormat('pt-BR');

/**
 * Liga as peças: identifica o usuário, abre o cache dele, mostra o que já está
 * no cache, sincroniza e redesenha. Toda chamada à API passa pelo `p.query`,
 * com as permissões de quem está usando o app.
 *
 * Sync e limpeza do cache compartilham um único "trabalho em andamento" por
 * aba; entre abas, o Web Locks serializa os syncs do mesmo usuário e pipe.
 */
export async function startDashboard(sdk: PipefyAppGlobal, p: PipefyClient, root: HTMLElement): Promise<void> {
  const pipeId = String(p.app.pipeId);
  const client = retrying(createSdkClient(p), { retries: 4, baseDelayMs: 1000 });
  const api = createPipefyApi(client, pipeId);
  const charts = createSdkChartRepository(p);

  let specs: ChartSpec[] = [];
  let chartsEditable = false;
  let cards: CardRecord[] = [];
  let store: IdbCardStore | null = null;
  let engine: SyncEngine | null = null;
  let running: Promise<void> | null = null;
  /** Pedido de sync que chegou durante outro: roda mais uma vez ao terminar. */
  let rerun = false;
  /** Sessão trocada ou cache fechado por outra aba: para de sincronizar. */
  let halted = false;
  let liveTimer: ReturnType<typeof setTimeout> | undefined;

  const view = new DashboardView(root, {
    onAddChart(spec) {
      if (!chartsEditable) return;
      specs = [...specs, { ...spec, id: crypto.randomUUID() }];
      void persistCharts();
    },
    onRemoveChart(id) {
      if (!chartsEditable) return;
      specs = specs.filter((s) => s.id !== id);
      void persistCharts();
    },
    onSync: () => void sync(),
    onClearCache: () => void clearCache(),
  });
  view.setBusy(true);

  view.setStatus('Identificando usuário…', 'busy');
  const me = await client.request<{ me: { id: string } | null }>('{ me { id } }');
  if (!me.me?.id) throw new Error('Não foi possível identificar o usuário logado.');
  const userId = String(me.me.id);

  await openForUser();
  cards = await store!.all();
  await loadCharts();
  redraw();
  registerLiveUpdates();
  await sync();

  async function openForUser() {
    store = await openCardStore(userId, pipeId, {
      onClosedByOtherTab() {
        halt('O cache foi limpo em outra aba. Recarregue a página para continuar.');
      },
    });
    engine = new SyncEngine(api, store, { userId, onProgress });
  }

  async function loadCharts() {
    try {
      specs = await charts.load();
      chartsEditable = true;
    } catch (error) {
      // Sem conseguir ler, não deixa editar: salvar agora apagaria as visões que não vieram.
      console.error('[dashboard] falha ao ler visões', error);
      chartsEditable = false;
      view.setStatus('Não foi possível carregar suas visões salvas. Recarregue a página.', 'error');
    }
    view.setChartsEditable(chartsEditable);
  }

  function redraw() {
    view.renderCharts(specs, cards);
    view.setMeta(`${integer.format(cards.length)} cards no cache local deste usuário`);
  }

  async function persistCharts() {
    redraw();
    try {
      await charts.save(specs);
    } catch (error) {
      console.error('[dashboard] falha ao salvar visões', error);
      view.setStatus('Não foi possível salvar as visões.', 'error');
    }
  }

  function onProgress(progress: SyncProgress) {
    const label = { 'full-load': 'Carga inicial', incremental: 'Atualizando', reconcile: 'Conferindo exclusões' }[
      progress.phase
    ];
    const total = progress.total === null ? '' : ` de ${integer.format(progress.total)}`;
    view.setStatus(`${label}: ${integer.format(progress.loaded)}${total}…`, 'busy');
    view.setProgress(progress.loaded, progress.total);
  }

  /** Um trabalho por vez nesta aba. Um sync pedido durante outro roda logo depois. */
  function exclusive(task: () => Promise<void>): Promise<void> {
    view.setBusy(true);
    running = task().finally(() => {
      running = null;
      view.setProgress(0, null);
      view.setBusy(halted);
    });
    return running;
  }

  function sync(): Promise<void> {
    if (halted) return Promise.resolve();
    if (running) {
      rerun = true;
      return running;
    }
    return exclusive(async () => {
      do {
        rerun = false;
        await runSync();
      } while (rerun && !halted);
    });
  }

  async function runSync() {
    if (!engine || !store) return;
    const current = { engine, store };
    view.setStatus('Sincronizando…', 'busy');
    try {
      // Espera (em vez de desistir) se outra aba estiver sincronizando: quando
      // ela terminar, este sync é um incremental barato e já recarrega o cache.
      const result = await withLock(`sync:${userId}:${pipeId}`, () => current.engine.sync());
      if (result.upserted || result.deleted || cards.length === 0) {
        cards = await current.store.all();
        redraw();
      }
      view.setStatus(describe(result), 'info');
    } catch (error) {
      if (error instanceof SessionChangedError) return halt(error.message);
      if (halted) return;
      console.error('[dashboard] falha no sync', error);
      const message = error instanceof Error ? error.message : String(error);
      view.setStatus(`Falha ao sincronizar: ${message}. O progresso foi salvo; tente de novo.`, 'error');
    }
  }

  function clearCache(): Promise<void> {
    if (running || halted || !store) return Promise.resolve();
    return exclusive(async () => {
      try {
        view.setStatus('Limpando o cache local…', 'busy');
        store?.close();
        store = null;
        engine = null;
        await deleteCardStore(userId, pipeId, () =>
          view.setStatus('Feche as outras abas com este dashboard para limpar o cache.', 'busy'),
        );
        await openForUser();
        cards = [];
        redraw();
        await runSync();
      } catch (error) {
        console.error('[dashboard] falha ao limpar o cache', error);
        halt('Não foi possível limpar o cache. Recarregue a página.');
      }
    });
  }

  /**
   * Para de sincronizar e de editar as visões, e avisa o usuário. O que já está
   * na tela continua visível. Depois de uma troca de sessão, o `p.set` gravaria
   * as visões deste usuário nas do novo.
   */
  function halt(message: string) {
    halted = true;
    clearTimeout(liveTimer);
    chartsEditable = false;
    view.setChartsEditable(false);
    view.setStatus(message, 'error');
    view.setBusy(true);
  }

  function registerLiveUpdates() {
    const schedule = () => {
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => void sync(), LIVE_SYNC_DELAY_MS);
    };
    // Criação e alteração chegam pelo incremental. A documentação diz que o
    // `onCardUpdated` só cobre mudança de vencimento; o incremental cobre o resto.
    sdk.registerListener('onCardCreated', schedule);
    sdk.registerListener('onCardUpdated', schedule);
    // Exclusão não aparece no filtro por updated_at. Com o app aberto, o
    // listener remove o card na hora e a contagem volta a bater, então o sync
    // seguinte não precisa reconciliar. O payload traz `internalId` e `id`
    // (curto); a documentação não diz qual é o id da API, então removemos os
    // dois: apagar uma chave inexistente não tem efeito. O estado do sync não é
    // tocado, para não sobrescrever o que um sync em andamento gravou.
    sdk.registerListener('onCardDeleted', (card) => {
      const target = store;
      if (!target || halted) return;
      const remove = [card.internalId, card.id].filter(Boolean).map(String);
      target
        .commit({ remove })
        .then(() => target.all())
        .then((all) => {
          cards = all;
          redraw();
        })
        .catch((error: unknown) => console.error('[dashboard] falha ao remover card excluído', error));
    });
  }
}

function describe(result: SyncResult): string {
  const parts = [
    result.mode === 'full' ? 'Carga inicial concluída' : 'Atualizado',
    count(result.calls, 'chamada à API', 'chamadas à API'),
  ];
  if (result.upserted) parts.push(count(result.upserted, 'card gravado', 'cards gravados'));
  if (result.deleted) parts.push(count(result.deleted, 'removido', 'removidos'));
  if (result.skipped) parts.push(count(result.skipped, 'ignorado', 'ignorados') + ' por dados inválidos');
  return `${parts.join(' · ')} · ${dateTime.format(new Date())}`;
}

const count = (n: number, one: string, many: string) => `${integer.format(n)} ${n === 1 ? one : many}`;

/** Exclusão mútua entre abas do mesmo navegador (quando o Web Locks existe). */
async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (!('locks' in navigator)) return fn();
  return navigator.locks.request(name, fn);
}
