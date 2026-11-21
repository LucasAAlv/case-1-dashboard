/**
 * Tipos mínimos do SDK de Apps da Pipefy (`window.PipefyApp`).
 *
 * O SDK não está no npm: é carregado por <script> em
 * https://platform.staticpipefy.com/pipefy-app.js. Aqui só tipamos o que o app
 * usa, conforme developers.pipefy.com (ver docs/pesquisa-sdk-apps.md).
 */

/** Resultado de `p.query`. A promise nunca rejeita: o erro vem em `errors`. */
export interface PipefyQueryResult<T> {
  data?: T | null;
  /** Array para erros GraphQL, ou um único `Error` para erro de transporte. */
  errors?: ReadonlyArray<PipefyGraphQLError> | Error | string;
}

export interface PipefyGraphQLError {
  message: string;
  extensions?: { code?: string; correlation_id?: string };
}

export interface PipefyClient {
  app: { pipeId: string | number };
  organizationId?: string | number;
  query<T>(query: string, variables?: Record<string, unknown>): Promise<PipefyQueryResult<T>>;
}

export interface PipeViewDescriptor {
  icon: string;
  text: string;
  url: string;
}

/** Payload dos eventos do pipe-view: `id` é o id curto do card. */
export interface CardEventPayload {
  internalId: string;
  id: string;
}

export type PipeViewEvent = 'onCardCreated' | 'onCardDeleted' | 'onCardUpdated';

export interface PipefyAppGlobal {
  init(): PipefyClient;
  initCall(handlers: {
    'pipe-view'?: (p: PipefyClient, pipe: { id: string; name: string }) => PipeViewDescriptor;
  }): void;
  render(callback: () => void): void;
  registerListener(event: PipeViewEvent, callback: (card: CardEventPayload) => void): void;
}

declare global {
  interface Window {
    PipefyApp?: PipefyAppGlobal;
  }
}
