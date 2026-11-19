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
  if (!userId.trim() || !pipeId.trim()) throw new Error('userId e pipeId são obrigatórios');
  return `pipefy-dashboard:${userId}:${pipeId}`;
}

export interface IdbCardStore extends CardStore {
  close(): void;
}

export interface OpenOptions {
  /** Outra aba pediu para apagar ou atualizar o banco e esta conexão foi fechada. */
  onClosedByOtherTab?: () => void;
}

export async function openCardStore(userId: string, pipeId: string, options: OpenOptions = {}): Promise<IdbCardStore> {
  const db = await openDB<CacheSchema>(cacheName(userId, pipeId), VERSION, {
    upgrade(database) {
      database.createObjectStore('cards', { keyPath: 'id' });
      database.createObjectStore('meta');
    },
    // Sem fechar aqui, o `deleteDB` de outra aba ficaria bloqueado para sempre.
    blocking() {
      db.close();
      options.onClosedByOtherTab?.();
    },
  });
  return new IdbStore(db);
}

/**
 * Apaga o cache de um usuário (botão "limpar cache" e testes). Se outra aba
 * ainda segurar o banco, `onBlocked` avisa; a exclusão continua quando ela fechar.
 */
export async function deleteCardStore(userId: string, pipeId: string, onBlocked?: () => void): Promise<void> {
  await deleteDB(cacheName(userId, pipeId), onBlocked ? { blocked: onBlocked } : {});
}

const ignore = () => {};

class IdbStore implements IdbCardStore {
  constructor(private readonly db: IDBPDatabase<CacheSchema>) {}

  async loadState(): Promise<SyncState | null> {
    return (await this.db.get('meta', 'sync')) ?? null;
  }

  /** Uma transação para cards e estado: se cair no meio, nada é gravado. */
  async commit({ upsert = [], remove = [], state }: StoreCommit): Promise<void> {
    const tx = this.db.transaction(['cards', 'meta'], 'readwrite');
    const cards = tx.objectStore('cards');
    // As requisições são enfileiradas na transação; esperar só o `done` evita
    // um ida-e-volta por card. Um erro (cota, por exemplo) chega pelo `tx.done`;
    // o `catch` vazio só evita uma rejeição não tratada por requisição.
    for (const card of upsert) cards.put(card).catch(ignore);
    for (const id of remove) cards.delete(id).catch(ignore);
    if (state) tx.objectStore('meta').put(state, 'sync').catch(ignore);
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
