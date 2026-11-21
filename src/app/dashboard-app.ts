import { deleteCardStore, openCardStore, type IdbCardStore } from '../cache/idb-store';
import { createSdkChartRepository } from '../charts/chart-repository';
import type { ChartSpec } from '../charts/chart-spec';
import type { CardRecord } from '../domain/card';
import type { PipefyAppGlobal, PipefyClient } from '../pipefy/sdk';
import { createSdkClient, retrying } from '../sync/graphql-client';
import { createPipefyApi } from '../sync/pipefy-api';
import { SyncEngine, type SyncProgress, type SyncResult } from '../sync/sync-engine';
import { DashboardView } from '../ui/dashboard-view';

/** Espera antes de sincronizar depois de um evento de card (junta rajadas). */
const LIVE_SYNC_DELAY_MS = 2000;

const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
const integer = new Intl.NumberFormat('pt-BR');

/**
 * Liga as peças: identifica o usuário, abre o cache dele, mostra o que já está
 * no cache, sincroniza e redesenha. Toda chamada à API passa pelo `p.query`,
 * com as permissões de quem está usando o app.
 */
export async function startDashboard(sdk: PipefyAppGlobal, p: PipefyClient, root: HTMLElement): Promise<void> {
  const pipeId = String(p.app.pipeId);
  const client = retrying(createSdkClient(p), { retries: 4, baseDelayMs: 1000 });
  const charts = createSdkChartRepository(p);

  let specs: ChartSpec[] = [];
  let cards: CardRecord[] = [];
  let store: IdbCardStore;
  let engine: SyncEngine;
  let running: Promise<void> | null = null;
  let liveTimer: ReturnType<typeof setTimeout> | undefined;

  const view = new DashboardView(root, {
    onAddChart(spec) {
      specs = [...specs, { ...spec, id: crypto.randomUUID() }];
      void persistCharts();
    },
    onRemoveChart(id) {
      specs = specs.filter((s) => s.id !== id);
      void persistCharts();
    },
    onSync: () => void sync(),
    async onClearCache() {
      if (running) return;
      store.close();
      await deleteCardStore(userId, pipeId);
      ({ store, engine } = await openForUser(userId));
      cards = [];
      redraw();
      void sync();
    },
  });

  view.setStatus('Identificando usuário…', 'busy');
  const me = await client.request<{ me: { id: string } | null }>('{ me { id } }');
  if (!me.me?.id) throw new Error('Não foi possível identificar o usuário logado.');
  const userId = me.me.id;

  ({ store, engine } = await openForUser(userId));
  [specs, cards] = await Promise.all([charts.load(), store.all()]);
  redraw();
  registerLiveUpdates();
  await sync();

  async function openForUser(id: string) {
    const opened = await openCardStore(id, pipeId);
    const api = createPipefyApi(client, pipeId);
    return { store: opened, engine: new SyncEngine(api, opened, { onProgress }) };
  }

  function redraw() {
    view.renderCharts(specs, cards);
    view.setMeta(`${integer.format(cards.length)} cards no cache local deste usuário`);
  }

  async function persistCharts() {
    redraw();
    try {
      await charts.save(specs);
    } catch {
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

  /** Um sync por vez nesta aba; entre abas, o Web Locks evita trabalho duplicado. */
  function sync(): Promise<void> {
    running ??= runSync().finally(() => {
      running = null;
      view.setProgress(0, null);
    });
    return running;
  }

  async function runSync() {
    view.setStatus('Sincronizando…', 'busy');
    try {
      const result = await withLock(`sync:${userId}:${pipeId}`, () => engine.sync());
      if (result === null) {
        view.setStatus('Outra aba está sincronizando.', 'info');
        return;
      }
      if (result.upserted || result.deleted || cards.length === 0) {
        cards = await store.all();
        redraw();
      }
      view.setStatus(describe(result), 'info');
    } catch (error) {
      console.error('[dashboard] falha no sync', error);
      const message = error instanceof Error ? error.message : String(error);
      view.setStatus(`Falha ao sincronizar: ${message}. O progresso foi salvo; tente de novo.`, 'error');
    }
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
    // seguinte não precisa reconciliar. Com o app fechado, vale a reconciliação
    // pelo cards_count. O payload traz `internalId` e `id` (curto); a
    // documentação não diz qual é o id da API, então removemos os dois:
    // apagar uma chave inexistente não tem efeito.
    sdk.registerListener('onCardDeleted', (card) => {
      void (async () => {
        const state = await store.loadState();
        if (!state) return;
        await store.commit({ remove: [card.internalId, card.id].filter(Boolean).map(String), state });
        cards = await store.all();
        redraw();
      })();
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

/** Executa com exclusão mútua entre abas; devolve null se outra aba já tem o lock. */
async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  if (!('locks' in navigator)) return fn();
  return navigator.locks.request(name, { ifAvailable: true }, (lock) => (lock ? fn() : null));
}
