import type { CardStore, SyncState } from '../cache/card-store';
import type { CardRecord } from '../domain/card';
import { parseCard, type RawCard } from '../domain/card-parser';
import type { PipefyApi } from './pipefy-api';
import { incrementalSince, nextWatermark, toUtcSeconds } from './watermark';

export interface SyncProgress {
  phase: 'full-load' | 'incremental' | 'reconcile';
  /** Cards gravados nesta fase até agora (na carga, inclui o que já estava no cache). */
  loaded: number;
  /** Total esperado, quando conhecido (`cards_count` do pipe). */
  total: number | null;
}

export interface SyncResult {
  mode: 'full' | 'incremental';
  /** Chamadas à API neste sync: o número que mostra o custo de cada estratégia. */
  calls: number;
  upserted: number;
  deleted: number;
  /** Cards descartados por dados inválidos (sem id ou com updated_at inválido). */
  skipped: number;
  reconciled: boolean;
}

export interface SyncOptions {
  now?: () => Date;
  /** Margem subtraída da marca d'água no filtro. Padrão: 5 min. */
  marginSeconds?: number;
  onProgress?: (progress: SyncProgress) => void;
}

/**
 * Folga para diferença de relógio entre o navegador e a Pipefy e para gravações
 * que ficam visíveis com atraso. Custa só rebaixar os cards alterados nos
 * últimos minutos antes do sync anterior.
 */
export const DEFAULT_MARGIN_SECONDS = 300;

const EMPTY_STATE: SyncState = {
  phase: 'full-load',
  cursor: null,
  startedAt: null,
  watermark: null,
  lastSyncAt: null,
  reconciledPipeCount: null,
};

/**
 * Sincroniza o cache local de um usuário com o pipe.
 *
 * 1. Lê o `cards_count` do pipe (1 chamada).
 * 2. Sem cache pronto: carga inicial paginada, gravando o cursor a cada página.
 *    Com cache pronto: incremental por `updated_at`, com upsert por id.
 * 3. Se o `cards_count` divergir do cache, reconcilia: exclusões e cards faltando.
 */
export class SyncEngine {
  private readonly now: () => Date;
  private readonly marginSeconds: number;
  private readonly onProgress: ((p: SyncProgress) => void) | undefined;
  private calls = 0;
  private skipped = 0;

  constructor(
    private readonly api: PipefyApi,
    private readonly store: CardStore,
    options: SyncOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.marginSeconds = options.marginSeconds ?? DEFAULT_MARGIN_SECONDS;
    this.onProgress = options.onProgress;
  }

  async sync(): Promise<SyncResult> {
    this.calls = 0;
    this.skipped = 0;
    const startedAt = toUtcSeconds(this.now());
    let state = (await this.store.loadState()) ?? { ...EMPTY_STATE };

    const pipeCount = await this.call(() => this.api.cardsCount());
    const mode = state.phase === 'ready' ? 'incremental' : 'full';

    let upserted: number;
    if (mode === 'full') {
      ({ state, upserted } = await this.fullLoad(state, startedAt, pipeCount));
    } else {
      ({ state, upserted } = await this.incremental(state, startedAt));
    }

    let deleted = 0;
    let reconciled = false;
    const cachedCount = await this.store.count();
    if (cachedCount !== pipeCount && pipeCount !== state.reconciledPipeCount) {
      let restored: number;
      ({ state, deleted, upserted: restored } = await this.reconcile(state, pipeCount));
      upserted += restored;
      reconciled = true;
    }

    state = { ...state, lastSyncAt: startedAt };
    await this.store.commit({ state });
    return { mode, calls: this.calls, upserted, deleted, skipped: this.skipped, reconciled };
  }

  /** Carga inicial: retoma do cursor salvo, se houver. */
  private async fullLoad(initial: SyncState, startedAt: string, pipeCount: number) {
    let state: SyncState = { ...initial, startedAt: initial.startedAt ?? startedAt };
    let loaded = await this.store.count();
    let upserted = 0;

    for (let hasNext = true; hasNext; ) {
      const page = await this.call(() => this.api.cardsPage({ after: state.cursor, updatedSince: null }));
      const cards = this.parseAll(page.items);
      state = { ...state, cursor: page.endCursor };
      await this.store.commit({ upsert: cards, state });
      upserted += cards.length;
      loaded += cards.length;
      this.onProgress?.({ phase: 'full-load', loaded, total: pipeCount });
      hasNext = page.hasNextPage && page.endCursor !== null;
    }

    // A carga inteira vale como reconciliação: o cache tem exatamente o que o usuário vê.
    state = {
      ...state,
      phase: 'ready',
      cursor: null,
      // Início da primeira tentativa: cobre o que mudou enquanto a carga estava parada.
      watermark: nextWatermark(null, state.startedAt ?? startedAt),
      startedAt: null,
      reconciledPipeCount: pipeCount,
    };
    await this.store.commit({ state });
    return { state, upserted };
  }

  /** Incremental: a marca só avança quando todas as páginas foram gravadas. */
  private async incremental(state: SyncState, startedAt: string) {
    const since = state.watermark === null ? null : incrementalSince(state.watermark, this.marginSeconds);
    let after: string | null = null;
    let upserted = 0;

    for (let hasNext = true; hasNext; ) {
      const page = await this.call(() => this.api.cardsPage({ after, updatedSince: since }));
      const cards = this.parseAll(page.items);
      if (cards.length > 0) await this.store.commit({ upsert: cards, state });
      upserted += cards.length;
      this.onProgress?.({ phase: 'incremental', loaded: upserted, total: null });
      after = page.endCursor;
      hasNext = page.hasNextPage && after !== null;
    }

    const next: SyncState = { ...state, watermark: nextWatermark(state.watermark, startedAt) };
    return { state: next, upserted };
  }

  /**
   * Reconciliação: pagina o pipe inteiro de novo, faz upsert de tudo e remove do
   * cache o que não veio. Resolve dois casos que o filtro por `updated_at` não
   * vê: exclusões e cards que faltam no cache com `updated_at` antigo (por
   * exemplo, quando o usuário passa a enxergar um card que já existia).
   *
   * Baixar os cards completos custa as mesmas ~400 chamadas que baixar só os
   * ids (o `allCards` devolve 50 por página de qualquer jeito). Por isso só
   * roda quando o `cards_count` muda.
   */
  private async reconcile(state: SyncState, pipeCount: number) {
    const seen = new Set<string>();
    let after: string | null = null;
    let upserted = 0;
    for (let hasNext = true; hasNext; ) {
      const page = await this.call(() => this.api.cardsPage({ after, updatedSince: null }));
      // Ids de cards inválidos também contam como "existem no pipe".
      for (const raw of page.items) seen.add(String(raw.id));
      const cards = this.parseAll(page.items);
      if (cards.length > 0) await this.store.commit({ upsert: cards, state });
      upserted += cards.length;
      this.onProgress?.({ phase: 'reconcile', loaded: seen.size, total: pipeCount });
      after = page.endCursor;
      hasNext = page.hasNextPage && after !== null;
    }

    const remove = (await this.store.ids()).filter((id) => !seen.has(id));
    const next: SyncState = { ...state, reconciledPipeCount: pipeCount };
    await this.store.commit({ remove, state: next });
    return { state: next, deleted: remove.length, upserted };
  }

  private parseAll(items: readonly RawCard[]): CardRecord[] {
    const cards: CardRecord[] = [];
    for (const raw of items) {
      try {
        cards.push(parseCard(raw));
      } catch {
        this.skipped += 1;
      }
    }
    return cards;
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    this.calls += 1;
    return fn();
  }
}
