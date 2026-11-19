import { describe, expect, it, vi } from 'vitest';
import { createPipefyApi } from '../../src/sync/pipefy-api';
import type { GraphQLClient } from '../../src/sync/graphql-client';

function clientReturning(data: unknown) {
  const request = vi.fn().mockResolvedValue(data);
  return { client: { request } as GraphQLClient, request };
}

const page = {
  allCards: {
    pageInfo: { hasNextPage: true, endCursor: 'abc' },
    edges: [{ node: { id: '1', updated_at: '2026-11-12T18:56:00Z', fields: [] } }],
  },
};

describe('createPipefyApi', () => {
  it('pede 50 cards por página e devolve o cursor', async () => {
    const { client, request } = clientReturning(page);
    const result = await createPipefyApi(client, '307434671').cardsPage({ after: null, updatedSince: null });
    expect(result).toEqual({
      items: [{ id: '1', updated_at: '2026-11-12T18:56:00Z', fields: [] }],
      hasNextPage: true,
      endCursor: 'abc',
    });
    const query = request.mock.calls[0]![0] as string;
    expect(query).toContain('allCards(pipeId: 307434671, first: 50');
    expect(query).not.toContain('after:');
    expect(query).not.toContain('filter:');
  });

  it('inclui o cursor e o filtro de updated_at, escapando os valores', async () => {
    const { client, request } = clientReturning(page);
    await createPipefyApi(client, '307434671').cardsPage({
      after: 'WyIzLjAiXQ==',
      updatedSince: '2026-11-19T00:11:48Z',
    });
    const query = request.mock.calls[0]![0] as string;
    expect(query).toContain('after: "WyIzLjAiXQ=="');
    expect(query).toContain('filter: { field: "updated_at", operator: gte, value: "2026-11-19T00:11:48Z" }');
  });

  it('não deixa um cursor malicioso quebrar a query', async () => {
    const { client, request } = clientReturning(page);
    await createPipefyApi(client, '1').cardsPage({ after: 'x") { evil } #', updatedSince: null });
    expect(request.mock.calls[0]![0]).toContain('after: "x\\") { evil } #"');
  });

  it('recusa pipeId que não seja numérico', () => {
    const { client } = clientReturning(page);
    expect(() => createPipefyApi(client, '1) { x }')).toThrow();
  });

  it('lê o cards_count do pipe', async () => {
    const { client } = clientReturning({ pipe: { cards_count: 20000 } });
    await expect(createPipefyApi(client, '1').cardsCount()).resolves.toBe(20000);
  });
});
