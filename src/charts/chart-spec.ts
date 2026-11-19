import type { Aggregation, Dimension } from '../analytics/aggregate';

export type ChartType = 'bar' | 'barH' | 'line' | 'doughnut';

/** Uma visão do painel: dimensão + agregação (sobre Valor Total) + tipo de gráfico. */
export interface ChartSpec {
  id: string;
  title: string;
  dimension: Dimension;
  aggregation: Aggregation;
  chartType: ChartType;
  /** Máximo de grupos antes de juntar a cauda em "Outros". */
  limit: number;
}

export const DIMENSIONS: Record<Dimension, string> = {
  state: 'Estado',
  city: 'Cidade',
  companyBase: 'Empresa (sem sufixo)',
  company: 'Empresa (texto original)',
  emailDomain: 'Domínio do e-mail',
  contactName: 'Nome do contato',
  dueMonth: 'Mês da data limite',
  dueStatus: 'Situação de vencimento',
};

export const AGGREGATIONS: Record<Aggregation, string> = {
  count: 'Quantidade de cards',
  sum: 'Soma do Valor Total',
  avg: 'Média do Valor Total',
  min: 'Menor Valor Total',
  max: 'Maior Valor Total',
};

export const CHART_TYPES: Record<ChartType, string> = {
  bar: 'Barras verticais',
  barH: 'Barras horizontais',
  line: 'Linha',
  doughnut: 'Rosca',
};

/** Fica bem abaixo dos "few kilobytes per key" recomendados para o `p.set`. */
export const MAX_CHARTS = 24;
export const MAX_TITLE = 80;
export const MAX_LIMIT = 50;

const isKey = <T extends string>(map: Record<T, string>, value: unknown): value is T =>
  typeof value === 'string' && Object.hasOwn(map, value);

function toSpec(value: unknown): ChartSpec | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || !v.id) return null;
  if (!isKey(DIMENSIONS, v.dimension) || !isKey(AGGREGATIONS, v.aggregation) || !isKey(CHART_TYPES, v.chartType)) {
    return null;
  }
  if (typeof v.limit !== 'number' || !Number.isInteger(v.limit) || v.limit < 1 || v.limit > MAX_LIMIT) return null;
  const title = typeof v.title === 'string' ? v.title.trim().slice(0, MAX_TITLE) : '';
  return {
    id: v.id,
    title,
    dimension: v.dimension,
    aggregation: v.aggregation,
    chartType: v.chartType,
    limit: v.limit,
  };
}

/**
 * Lê as definições salvas. O conteúdo vem do armazenamento do SDK e é tratado
 * como não confiável: item inválido é descartado, JSON quebrado vira lista vazia.
 */
export function parseChartSpecs(raw: unknown): ChartSpec[] {
  if (typeof raw !== 'string') return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data
    .map(toSpec)
    .filter((s): s is ChartSpec => s !== null)
    .slice(0, MAX_CHARTS);
}

/** Título automático quando o usuário não escreve um. */
export function defaultTitle(spec: Pick<ChartSpec, 'dimension' | 'aggregation'>): string {
  return `${AGGREGATIONS[spec.aggregation]} por ${DIMENSIONS[spec.dimension].toLowerCase()}`;
}
