import type { RawCard } from '../../../src/domain/card-parser';
import type { CardsPage, PipefyApi } from '../../../src/sync/pipefy-api';
import type { CardRecord } from '../../../src/domain/card';
import type { CardStore, StoreCommit, SyncState } from '../../../src/cache/card-store';

export function rawCard(id: number, updatedAt = '2026-11-12T18:56:30Z', valor = '100'): RawCard {
  return {
    id: String(id),
    updated_at: updatedAt,
    fields: [
      { field: { id: 'estado' }, value: 'PR' },
      { field: { id: 'valor_total' }, value: valor },
    ],
  };
}

/**
 * Pipe falso que imita o `allCards`: ordem crescente de id, cursor pelo
 * último id, filtro `updated_at gte`. Conta as chamadas e permite simular falhas.
 */
export class FakePipe implements PipefyApi {
  cards: RawCard[];
  calls = 0;
  /** Faz a chamada de número N (1-based) falhar. */
  failOnCall: number | null = null;
  /** Total que o `cards_count` devolve; por padrão, o tamanho real. */
  reportedCount: number | null = null;
  /** Usuário da sessão atual da Pipefy (`me.id`). */
  userId = 'u1';
  /** Roda antes de responder cada página: simula mudanças concorrentes. */
  beforeCardsPage: (() => void) | null = null;
  /** Simula a anomalia `hasNextPage: true` sem `endCursor`. */
  dropCursor = false;

  constructor(
    cards: RawCard[],
    readonly pageSize = 50,
  ) {
    this.cards = [...cards];
  }

  private tick() {
    this.calls += 1;
    if (this.failOnCall === this.calls) throw new Error(`falha simulada na chamada ${this.calls}`);
  }

  private sorted() {
    return [...this.cards].sort((a, b) => Number(a.id) - Number(b.id));
  }

  /** Cursor por id, como o da API real: exclusões não deslocam a página seguinte. */
  private paginate(items: RawCard[], after: string | null): CardsPage<RawCard> {
    let start = after === null ? 0 : items.findIndex((c) => Number(c.id) > Number(after));
    if (start === -1) start = items.length;
    const page = items.slice(start, start + this.pageSize);
    const end = start + page.length;
    return { items: page, hasNextPage: end < items.length, endCursor: page.at(-1)?.id ?? null };
  }

  async cardsPage({ after, updatedSince }: { after: string | null; updatedSince: string | null }) {
    this.tick();
    this.beforeCardsPage?.();
    const items = this.sorted().filter((c) => updatedSince === null || c.updated_at >= updatedSince);
    const page = this.paginate(items, after);
    return this.dropCursor ? { ...page, endCursor: null } : page;
  }

  async status() {
    this.tick();
    return { userId: this.userId, cardsCount: this.reportedCount ?? this.cards.length };
  }

  update(id: number, updatedAt: string, valor: string) {
    this.cards = this.cards.map((c) => (c.id === String(id) ? rawCard(id, updatedAt, valor) : c));
  }
}

/** Store em memória com a mesma semântica transacional do IndexedDB. */
export class MemoryStore implements CardStore {
  cards = new Map<string, CardRecord>();
  state: SyncState | null = null;

  async loadState() {
    return this.state;
  }

  async commit({ upsert = [], remove = [], state }: StoreCommit) {
    for (const card of upsert) this.cards.set(card.id, card);
    for (const id of remove) this.cards.delete(id);
    if (state) this.state = structuredClone(state);
  }

  async count() {
    return this.cards.size;
  }

  async ids() {
    return [...this.cards.keys()];
  }

  async all() {
    return [...this.cards.values()];
  }
}
