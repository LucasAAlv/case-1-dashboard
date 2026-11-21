import { openDB, deleteDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CardRecord } from '../domain/card';
import type { CardStore, StoreCommit, SyncState } from './card-store';

interface CacheSchema extends DBSchema {
  cards: { key: string; value: CardRecord };
  meta: { key: 'sync'; value: SyncState };
}

const VERSION = 1;

/**
 * Um banco IndexedDB por usuário e pipe (`pipefy-dashboard:<userId>:<pipeId>`).
 *
 * O isolamento é estrutural: o app só abre o banco do `me.id` devolvido pela
 * Pipefy, então não existe query que misture dados de usuários diferentes.
 * Limitação: dois usuários no mesmo perfil de navegador ficam no mesmo
 * dispositivo; a separação é do app, não do sistema operacional.
 */
export function cacheName(userId: string, pipeId: string): string {
  // O `:` separa as partes do nome. Sem ele nos ids, dois pares diferentes
  // nunca geram o mesmo banco (D3). O pipeId segue a validação da API (D6).
  if (!/^[\w-]+$/.test(userId)) throw new Error(`userId inválido: ${userId}`);
  if (!/^\d+$/.test(pipeId)) throw new Error(`pipeId inválido: ${pipeId}`);
  return `pipefy-dashboard:${userId}:${pipeId}`;
}

export interface IdbCardStore extends CardStore {
  close(): void;
}

export async function openCardStore(userId: string, pipeId: string): Promise<IdbCardStore> {
  const db = await openDB<CacheSchema>(cacheName(userId, pipeId), VERSION, {
    upgrade(database) {
      database.createObjectStore('cards', { keyPath: 'id' });
      database.createObjectStore('meta');
    },
  });
  return new IdbStore(db);
}

/** Apaga o cache de um usuário (botão "limpar cache" e testes). */
export async function deleteCardStore(userId: string, pipeId: string): Promise<void> {
  await deleteDB(cacheName(userId, pipeId));
}

class IdbStore implements IdbCardStore {
  constructor(private readonly db: IDBPDatabase<CacheSchema>) {}

  async loadState(): Promise<SyncState | null> {
    return (await this.db.get('meta', 'sync')) ?? null;
  }

  /** Uma transação para cards e estado: se cair no meio, nada é gravado. */
  async commit({ upsert = [], remove = [], state }: StoreCommit): Promise<void> {
    const tx = this.db.transaction(['cards', 'meta'], 'readwrite');
    const cards = tx.objectStore('cards');
    // As requisições são enfileiradas na transação; esperar só o `done`
    // evita um ida-e-volta por card.
    for (const card of upsert) void cards.put(card);
    for (const id of remove) void cards.delete(id);
    void tx.objectStore('meta').put(state, 'sync');
    await tx.done;
  }

  count(): Promise<number> {
    return this.db.count('cards');
  }

  ids(): Promise<string[]> {
    return this.db.getAllKeys('cards');
  }

  all(): Promise<CardRecord[]> {
    return this.db.getAll('cards');
  }

  close(): void {
    this.db.close();
  }
}
