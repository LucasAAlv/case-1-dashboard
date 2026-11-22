import type { CardRecord } from '../domain/card';

/** Estado do sync de um usuário num pipe, guardado junto com os cards. */
export interface SyncState {
  /** `full-load` enquanto a carga inicial não termina; `ready` depois. */
  phase: 'full-load' | 'ready';
  /** Cursor da última página gravada na carga inicial, para retomar. */
  cursor: string | null;
  /** Início da primeira tentativa da carga inicial (UTC): vira a marca d'água ao fim da carga. */
  startedAt: string | null;
  /** Marca d'água do incremental (UTC): início do último sync concluído. */
  watermark: string | null;
  lastSyncAt: string | null;
  /** `cards_count` do pipe na última reconciliação de ids. */
  reconciledPipeCount: number | null;
}

export interface StoreCommit {
  upsert?: readonly CardRecord[];
  remove?: readonly string[];
  /** Omitido quando a gravação não muda o estado do sync (páginas do incremental, exclusão por evento). */
  state?: SyncState;
}

/**
 * Cache de cards de um usuário num pipe. Cada instância já está restrita a um
 * usuário: o isolamento é feito por quem cria o store, não por filtro em query.
 */
export interface CardStore {
  loadState(): Promise<SyncState | null>;
  /** Grava cards e estado na mesma transação: o cursor nunca fica à frente dos dados. */
  commit(changes: StoreCommit): Promise<void>;
  count(): Promise<number>;
  ids(): Promise<string[]>;
  all(): Promise<CardRecord[]>;
}
