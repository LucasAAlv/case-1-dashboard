import { describe, expect, it, vi } from 'vitest';
import {
  GraphQLRequestError,
  createSdkClient,
  withRetry,
} from '../../../src/sync/graphql-client';
import type { PipefyClient, PipefyQueryResult } from '../../../src/pipefy/sdk';

function sdkReturning(...results: PipefyQueryResult<unknown>[]): PipefyClient {
  const query = vi.fn();
  for (const r of results) query.mockResolvedValueOnce(r);
  return { app: { pipeId: '1' }, query } as unknown as PipefyClient;
}

describe('createSdkClient', () => {
  it('devolve data quando não há erro', async () => {
    const client = createSdkClient(sdkReturning({ data: { me: { id: '7' } } }));
    await expect(client.request('{ me { id } }')).resolves.toEqual({ me: { id: '7' } });
  });

  it('lança erro com os códigos quando errors é um array (mesmo com HTTP 200 e data)', async () => {
    const client = createSdkClient(
      sdkReturning({
        data: { pipe: null },
        errors: [{ message: 'Permission denied', extensions: { code: 'PERMISSION_DENIED' } }],
      }),
    );
    const error = await client.request('{ pipe(id: 1) { id } }').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GraphQLRequestError);
    expect(error).toMatchObject({ codes: ['PERMISSION_DENIED'], retryable: false });
  });

  it('trata errors como um único Error (falha de transporte) e marca como retentável', async () => {
    const client = createSdkClient(sdkReturning({ errors: new Error('Network down') }));
    await expect(client.request('{ me { id } }')).rejects.toMatchObject({ retryable: true });
  });

  it('marca estouro de cota como retentável', async () => {
    const client = createSdkClient(
      sdkReturning({ errors: [{ message: 'limit', extensions: { code: 'USAGE_LIMIT_EXCEEDED' } }] }),
    );
    await expect(client.request('{ me { id } }')).rejects.toMatchObject({ retryable: true });
  });

  it('lança erro quando não há data nem errors', async () => {
    const client = createSdkClient(sdkReturning({}));
    await expect(client.request('{ me { id } }')).rejects.toBeInstanceOf(GraphQLRequestError);
  });
});

describe('withRetry', () => {
  const noSleep = (_ms: number) => Promise.resolve();

  it('repete erros retentáveis com backoff exponencial e devolve o resultado', async () => {
    const sleep = vi.fn(noSleep);
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new GraphQLRequestError('cota', ['USAGE_LIMIT_EXCEEDED'], true))
      .mockRejectedValueOnce(new GraphQLRequestError('rede', [], true))
      .mockResolvedValueOnce('ok');
    await expect(withRetry(fn, { retries: 3, baseDelayMs: 100, sleep })).resolves.toBe('ok');
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([100, 200]);
  });

  it('não repete erro definitivo', async () => {
    const fn = vi.fn().mockRejectedValue(new GraphQLRequestError('negado', ['PERMISSION_DENIED'], false));
    await expect(withRetry(fn, { retries: 3, baseDelayMs: 1, sleep: noSleep })).rejects.toThrow('negado');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('desiste depois do número máximo de tentativas', async () => {
    const fn = vi.fn().mockRejectedValue(new GraphQLRequestError('rede', [], true));
    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1, sleep: noSleep })).rejects.toThrow('rede');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
