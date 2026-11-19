import { describe, expect, it } from 'vitest';
import { aggregate, dueStatus } from '../../src/analytics/aggregate';
import type { CardRecord } from '../../src/domain/card';

function card(partial: Partial<CardRecord>): CardRecord {
  return {
    id: Math.random().toString(36).slice(2),
    updatedAt: '2026-11-12T18:56:30Z',
    contactName: null,
    email: null,
    emailDomain: null,
    company: null,
    companyBase: null,
    city: null,
    state: null,
    totalValue: null,
    dueDate: null,
    dueMonth: null,
    ...partial,
  };
}

const cards = [
  card({ state: 'PR', totalValue: 100 }),
  card({ state: 'PR', totalValue: 300 }),
  card({ state: 'SP', totalValue: 50 }),
  card({ state: 'SP', totalValue: null }),
  card({ state: null, totalValue: 10 }),
];

const TODAY = '2026-11-23';

describe('aggregate', () => {
  it('conta cards por dimensão, ordenando do maior para o menor', () => {
    expect(aggregate(cards, { dimension: 'state', aggregation: 'count' }, { today: TODAY })).toEqual([
      { label: 'PR', value: 2 },
      { label: 'SP', value: 2 },
      { label: '(vazio)', value: 1 },
    ]);
  });

  it('soma, média, mínimo e máximo ignoram valores nulos', () => {
    const run = (aggregation: 'sum' | 'avg' | 'min' | 'max') =>
      aggregate(cards, { dimension: 'state', aggregation }, { today: TODAY }).find((r) => r.label === 'SP')
        ?.value;
    expect(run('sum')).toBe(50);
    expect(run('avg')).toBe(50);
    expect(run('min')).toBe(50);
    expect(run('max')).toBe(50);
    expect(aggregate(cards, { dimension: 'state', aggregation: 'avg' }, { today: TODAY })[0]).toEqual({
      label: 'PR',
      value: 200,
    });
  });

  it('omite o grupo sem nenhum valor numérico em média, mínimo e máximo', () => {
    const only = [card({ state: 'RS', totalValue: null })];
    expect(aggregate(only, { dimension: 'state', aggregation: 'avg' }, { today: TODAY })).toEqual([]);
    expect(aggregate(only, { dimension: 'state', aggregation: 'sum' }, { today: TODAY })).toEqual([
      { label: 'RS', value: 0 },
    ]);
  });

  it('ordena dimensões de tempo pelo rótulo, não pelo valor', () => {
    const timeline = [
      card({ dueMonth: '2027-02' }),
      card({ dueMonth: '2026-11' }),
      card({ dueMonth: '2026-11' }),
      card({ dueMonth: '2027-01' }),
    ];
    const labels = aggregate(timeline, { dimension: 'dueMonth', aggregation: 'count' }, { today: TODAY }).map(
      (r) => r.label,
    );
    expect(labels).toEqual(['2026-11', '2027-01', '2027-02']);
  });

  it('junta a cauda em "Outros" quando passa do limite de grupos', () => {
    const many = Array.from({ length: 30 }, (_, i) => card({ city: `C${i}`, totalValue: i + 1 }));
    const result = aggregate(many, { dimension: 'city', aggregation: 'sum', limit: 5 }, { today: TODAY });
    expect(result).toHaveLength(6);
    expect(result.slice(0, 5).map((r) => r.value)).toEqual([30, 29, 28, 27, 26]);
    // 1 + 2 + ... + 25
    expect(result[5]).toEqual({ label: 'Outros', value: 325 });
  });

  it('calcula a média de "Outros" sobre os cards, não sobre as médias dos grupos', () => {
    const many = [
      card({ city: 'A', totalValue: 100 }),
      card({ city: 'B', totalValue: 10 }),
      card({ city: 'C', totalValue: 1 }),
      card({ city: 'C', totalValue: 3 }),
    ];
    const result = aggregate(many, { dimension: 'city', aggregation: 'avg', limit: 1 }, { today: TODAY });
    expect(result).toEqual([
      { label: 'A', value: 100 },
      { label: 'Outros', value: (10 + 1 + 3) / 3 },
    ]);
  });

  it('agrupa por situação de vencimento em relação a hoje', () => {
    const due = [
      card({ dueDate: '2026-11-20' }),
      card({ dueDate: '2026-11-23' }),
      card({ dueDate: '2026-11-30' }),
      card({ dueDate: '2027-03-01' }),
      card({ dueDate: null }),
    ];
    expect(aggregate(due, { dimension: 'dueStatus', aggregation: 'count' }, { today: TODAY })).toEqual([
      { label: 'Vencido', value: 1 },
      { label: 'Vence em até 7 dias', value: 2 },
      { label: 'A vencer', value: 1 },
      { label: '(vazio)', value: 1 },
    ]);
  });
});

describe('dueStatus', () => {
  it('considera vencido só o que passou de hoje', () => {
    expect(dueStatus('2026-11-22', TODAY)).toBe('Vencido');
    expect(dueStatus('2026-11-23', TODAY)).toBe('Vence em até 7 dias');
    expect(dueStatus('2026-11-30', TODAY)).toBe('Vence em até 7 dias');
    expect(dueStatus('2026-12-01', TODAY)).toBe('A vencer');
    expect(dueStatus(null, TODAY)).toBeNull();
  });
});
