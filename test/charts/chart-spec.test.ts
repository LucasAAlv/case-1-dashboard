import { describe, expect, it, vi } from 'vitest';
import { MAX_CHARTS, MAX_DOUGHNUT_LIMIT, parseChartSpecs, type ChartSpec } from '../../src/charts/chart-spec';
import { createSdkChartRepository } from '../../src/charts/chart-repository';
import type { PipefyClient } from '../../src/pipefy/sdk';

const valid: ChartSpec = {
  id: 'a1',
  title: 'Valor por estado',
  dimension: 'state',
  aggregation: 'sum',
  chartType: 'bar',
  limit: 10,
};

describe('parseChartSpecs', () => {
  it('aceita definições válidas', () => {
    expect(parseChartSpecs(JSON.stringify([valid]))).toEqual([valid]);
  });

  it('descarta itens inválidos sem perder os válidos', () => {
    const raw = JSON.stringify([
      valid,
      { ...valid, id: 'b', dimension: 'senha' },
      { ...valid, id: 'c', aggregation: 'median' },
      { ...valid, id: 'd', chartType: 'radar' },
      { ...valid, id: 'e', limit: -1 },
      null,
      'texto',
    ]);
    expect(parseChartSpecs(raw).map((s) => s.id)).toEqual(['a1']);
  });

  it('devolve lista vazia para JSON quebrado ou formato inesperado', () => {
    expect(parseChartSpecs('{quebrado')).toEqual([]);
    expect(parseChartSpecs('{"a":1}')).toEqual([]);
    expect(parseChartSpecs(null)).toEqual([]);
    expect(parseChartSpecs(undefined)).toEqual([]);
  });

  it('aplica as regras do construtor a uma visão salva', () => {
    const raw = JSON.stringify([
      { ...valid, id: 'rosca', chartType: 'doughnut', limit: 50 },
      { ...valid, id: 'mes', chartType: 'doughnut', dimension: 'dueMonth', limit: 50 },
      { ...valid, id: 'sem-titulo', title: '   ' },
      { ...valid, id: 'sem-campo', title: undefined },
    ]);
    const [doughnut, month, blank, missing] = parseChartSpecs(raw);
    expect(doughnut).toMatchObject({ chartType: 'doughnut', limit: MAX_DOUGHNUT_LIMIT });
    expect(month).toMatchObject({ chartType: 'line', limit: 50 });
    expect(blank!.title).toBe('Soma do Valor Total por estado');
    expect(missing!.title).toBe('Soma do Valor Total por estado');
  });

  it('limita o tamanho do título e o número de gráficos', () => {
    const many = Array.from({ length: MAX_CHARTS + 5 }, (_, i) => ({ ...valid, id: `x${i}`, title: 'a'.repeat(500) }));
    const parsed = parseChartSpecs(JSON.stringify(many));
    expect(parsed).toHaveLength(MAX_CHARTS);
    expect(parsed[0]!.title.length).toBeLessThanOrEqual(80);
  });
});

describe('createSdkChartRepository', () => {
  function sdk(stored: unknown) {
    const get = vi.fn().mockResolvedValue(stored);
    const set = vi.fn().mockResolvedValue(undefined);
    return { client: { get, set } as unknown as PipefyClient, get, set };
  }

  it('lê e grava no escopo do pipe, com visibilidade privada', async () => {
    const { client, get, set } = sdk(JSON.stringify([valid]));
    const repo = createSdkChartRepository(client);
    expect(await repo.load()).toEqual([valid]);
    await repo.save([valid]);
    expect(get).toHaveBeenCalledWith('pipe', 'private', 'charts');
    expect(set).toHaveBeenCalledWith('pipe', 'private', 'charts', JSON.stringify([valid]));
  });

  it('começa vazio se o p.get falhar', async () => {
    const client = { get: vi.fn().mockRejectedValue(new Error('x')) } as unknown as PipefyClient;
    expect(await createSdkChartRepository(client).load()).toEqual([]);
  });
});
