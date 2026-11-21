import type { CardRecord } from '../domain/card';

/**
 * Agregação sobre o cache local (decisão 7 do case): group by + count, sum,
 * avg, min ou max, numa passada só. Com 20 mil cards, leva poucos milissegundos.
 */

export type Dimension =
  | 'state'
  | 'city'
  | 'company'
  | 'companyBase'
  | 'emailDomain'
  | 'contactName'
  | 'dueMonth'
  | 'dueStatus';

export type Aggregation = 'count' | 'sum' | 'avg' | 'min' | 'max';

export interface AggregateQuery {
  dimension: Dimension;
  /** `count` conta cards; as demais operam sobre `totalValue` (Valor Total). */
  aggregation: Aggregation;
  /** Máximo de grupos; o resto vira "Outros". Padrão: 15. */
  limit?: number;
}

export interface AggregateRow {
  label: string;
  value: number;
}

export const EMPTY_LABEL = '(vazio)';
export const OTHERS_LABEL = 'Outros';
const DEFAULT_LIMIT = 15;

const DUE_STATUS = ['Vencido', 'Vence em até 7 dias', 'A vencer'] as const;
export type DueStatus = (typeof DUE_STATUS)[number];

/** Situação de vencimento da `data_limite` em relação a `today` (AAAA-MM-DD). */
export function dueStatus(dueDate: string | null, today: string): DueStatus | null {
  if (dueDate === null) return null;
  if (dueDate < today) return 'Vencido';
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + 7);
  return dueDate <= limit.toISOString().slice(0, 10) ? 'Vence em até 7 dias' : 'A vencer';
}

/** Como os grupos são ordenados no gráfico. */
const ORDER: Record<Dimension, 'value' | 'label' | 'fixed'> = {
  state: 'value',
  city: 'value',
  company: 'value',
  companyBase: 'value',
  emailDomain: 'value',
  contactName: 'value',
  dueMonth: 'label',
  dueStatus: 'fixed',
};

interface Accumulator {
  count: number;
  /** Quantos cards têm valor numérico. */
  n: number;
  sum: number;
  min: number;
  max: number;
}

const newAcc = (): Accumulator => ({ count: 0, n: 0, sum: 0, min: Infinity, max: -Infinity });

function add(acc: Accumulator, value: number | null) {
  acc.count += 1;
  if (value === null) return;
  acc.n += 1;
  acc.sum += value;
  if (value < acc.min) acc.min = value;
  if (value > acc.max) acc.max = value;
}

function merge(into: Accumulator, from: Accumulator) {
  into.count += from.count;
  into.n += from.n;
  into.sum += from.sum;
  into.min = Math.min(into.min, from.min);
  into.max = Math.max(into.max, from.max);
}

/** Valor final do grupo; null quando não há base (grupo sem nenhum valor numérico). */
function finalize(acc: Accumulator, aggregation: Aggregation): number | null {
  switch (aggregation) {
    case 'count':
      return acc.count;
    case 'sum':
      return acc.n ? acc.sum : null;
    case 'avg':
      return acc.n ? acc.sum / acc.n : null;
    case 'min':
      return acc.n ? acc.min : null;
    case 'max':
      return acc.n ? acc.max : null;
  }
}

/**
 * Rótulo de um grupo sintético ("Outros", "(vazio)"). Se um valor real tiver o
 * mesmo texto, o sintético ganha um sufixo, para o gráfico não mostrar duas
 * barras com o mesmo nome.
 */
function syntheticLabel(
  label: string,
  suffix: string,
  entries: readonly { label: string; value: number | null }[],
): string {
  // Grupo com valor null não aparece no gráfico, então não colide.
  return entries.some((entry) => entry.value !== null && entry.label === label) ? `${label} ${suffix}` : label;
}

function keyOf(card: CardRecord, dimension: Dimension, today: string): string | null {
  return dimension === 'dueStatus' ? dueStatus(card.dueDate, today) : card[dimension];
}

export function aggregate(
  cards: readonly CardRecord[],
  query: AggregateQuery,
  context: { today: string },
): AggregateRow[] {
  const groups = new Map<string | null, Accumulator>();
  for (const card of cards) {
    const key = keyOf(card, query.dimension, context.today);
    let acc = groups.get(key);
    if (!acc) groups.set(key, (acc = newAcc()));
    add(acc, card.totalValue);
  }

  const empty = groups.get(null);
  groups.delete(null);

  let entries = [...groups].map(([label, acc]) => ({
    label: label as string,
    acc,
    value: finalize(acc, query.aggregation),
  }));

  const order = ORDER[query.dimension];
  if (order === 'value') {
    entries.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity) || a.label.localeCompare(b.label));
  } else if (order === 'label') {
    entries.sort((a, b) => a.label.localeCompare(b.label));
  } else {
    const rank = (label: string) => DUE_STATUS.indexOf(label as DueStatus);
    entries.sort((a, b) => rank(a.label) - rank(b.label));
  }

  // Cauda em "Outros", recalculada a partir dos acumuladores (média correta).
  const limit = query.limit ?? DEFAULT_LIMIT;
  if (order === 'value' && entries.length > limit) {
    const others = newAcc();
    for (const entry of entries.slice(limit)) merge(others, entry.acc);
    const head = entries.slice(0, limit);
    const label = syntheticLabel(OTHERS_LABEL, '(demais grupos)', head);
    entries = [...head, { label, acc: others, value: finalize(others, query.aggregation) }];
  }
  if (empty) {
    const label = syntheticLabel(EMPTY_LABEL, '(sem valor)', entries);
    entries.push({ label, acc: empty, value: finalize(empty, query.aggregation) });
  }

  return entries.flatMap(({ label, value }) => (value === null ? [] : [{ label, value }]));
}
