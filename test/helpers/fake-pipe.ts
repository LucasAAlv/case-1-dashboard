import type { RawCard } from '../../src/domain/card-parser';
import type { CardsPage, PipefyApi } from '../../src/sync/pipefy-api';
import type { CardRecord } from '../../src/domain/card';
import type { CardStore, StoreCommit, SyncState } from '../../src/cache/card-store';

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
 * Pipe falso que imita o `allCards`: ordem crescente de id, cursor por
 * posição, filtro `updated_at gte`. Conta as chamadas e permite simular falhas.
 */
export class FakePipe implements PipefyApi {
  cards: RawCard[];
  calls = 0;
  /** Faz a chamada de número N (1-based) falhar. */
  failOnCall: number | null = null;
  /** Total que o `cards_count` devolve; por padrão, o tamanho real. */
  reportedCount: number | null = null;

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

  private paginate<T>(items: T[], after: string | null): CardsPage<T> {
    const start = after === null ? 0 : Number(after);
    const end = start + this.pageSize;
    return {
      items: items.slice(start, end),
      hasNextPage: end < items.length,
      endCursor: items.length ? String(Math.min(end, items.length)) : null,
    };
  }

  async cardsPage({ after, updatedSince }: { after: string | null; updatedSince: string | null }) {
    this.tick();
    const items = this.sorted().filter((c) => updatedSince === null || c.updated_at >= updatedSince);
    return this.paginate(items, after);
  }

  async cardIdsPage(after: string | null) {
    this.tick();
    return this.paginate(
      this.sorted().map((c) => c.id),
      after,
    );
  }

  async cardsCount() {
    this.tick();
    return this.reportedCount ?? this.cards.length;
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
    this.state = structuredClone(state);
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
