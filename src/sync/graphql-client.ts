import type { PipefyClient, PipefyGraphQLError } from '../pipefy/sdk';

/** Cliente GraphQL usado pelo sync. Lança erro em vez de devolver `errors`. */
export interface GraphQLClient {
  request<T>(query: string): Promise<T>;
}

export class GraphQLRequestError extends Error {
  override name = 'GraphQLRequestError';
  constructor(
    message: string,
    readonly codes: readonly string[],
    /** Vale tentar de novo: falha de rede, timeout ou estouro de cota. */
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

const RETRYABLE_CODES = new Set(['USAGE_LIMIT_EXCEEDED', 'TIMEOUT', 'INTERNAL_SERVER_ERROR']);

/**
 * Adapta o `p.query` do SDK. Ele roda com as permissões do usuário logado e
 * nunca rejeita a promise: o erro vem em `errors`, que pode ser um array
 * (erro GraphQL, mesmo com HTTP 200) ou um único `Error` (transporte).
 * Resposta parcial (`data` + `errors`) é tratada como erro: o sync precisa de
 * páginas completas.
 */
export function createSdkClient(p: PipefyClient): GraphQLClient {
  return {
    async request<T>(query: string): Promise<T> {
      const result = await p.query<T>(query);
      const { errors } = result;
      if (Array.isArray(errors) && errors.length > 0) {
        const list = errors as readonly PipefyGraphQLError[];
        const codes = list.map((e) => e.extensions?.code).filter((c): c is string => !!c);
        throw new GraphQLRequestError(
          list.map((e) => e.message).join('; '),
          codes,
          codes.some((c) => RETRYABLE_CODES.has(c)),
        );
      }
      if (errors && !Array.isArray(errors)) {
        throw new GraphQLRequestError(String(errors instanceof Error ? errors.message : errors), [], true);
      }
      if (result.data == null) throw new GraphQLRequestError('Resposta sem data', [], true);
      return result.data;
    },
  };
}

export interface RetryOptions {
  retries: number;
  baseDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Repete só erros retentáveis, com backoff exponencial (base, 2x base, 4x base...). */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const retryable = error instanceof GraphQLRequestError && error.retryable;
      if (!retryable || attempt >= options.retries) throw error;
      await sleep(options.baseDelayMs * 2 ** attempt);
    }
  }
}

/** Envolve um cliente com retry. */
export function retrying(client: GraphQLClient, options: RetryOptions): GraphQLClient {
  return { request: (query) => withRetry(() => client.request(query), options) };
}
