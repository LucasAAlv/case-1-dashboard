import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type ChartConfiguration,
} from 'chart.js';
import type { AggregateRow } from '../analytics/aggregate';
import { MAX_DOUGHNUT_SLICES, type ChartSpec } from './chart-spec';

// Registro explícito: só os módulos usados entram no bundle.
Chart.register(
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  DoughnutController,
  ArcElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
);

export { MAX_DOUGHNUT_SLICES };

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brlCompact = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact' });
const integer = new Intl.NumberFormat('pt-BR');

export function formatValue(spec: Pick<ChartSpec, 'aggregation'>, value: number, compact = false): string {
  if (spec.aggregation === 'count') return integer.format(value);
  return (compact ? brlCompact : brl).format(value);
}

/** Cores vêm dos tokens CSS, então seguem o tema claro ou escuro. */
function tokens() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    text: v('--text-secondary'),
    grid: v('--grid'),
    surface: v('--surface-1'),
    series: Array.from({ length: MAX_DOUGHNUT_SLICES }, (_, i) => v(`--series-${i + 1}`)),
  };
}

/** Desenha o gráfico no canvas e devolve a instância (para `destroy()`). */
export function renderChart(canvas: HTMLCanvasElement, spec: ChartSpec, rows: readonly AggregateRow[]): Chart {
  const t = tokens();
  const labels = rows.map((r) => r.label);
  const data = rows.map((r) => r.value);
  const tooltip = {
    callbacks: { label: (ctx: { dataIndex: number }) => formatValue(spec, data[ctx.dataIndex] ?? 0) },
  };

  Chart.defaults.color = t.text;
  Chart.defaults.font.family = 'inherit';

  if (spec.chartType === 'doughnut') {
    const config: ChartConfiguration<'doughnut'> = {
      type: 'doughnut',
      data: {
        labels,
        // Cores categóricas em ordem fixa; anel na cor da superfície separa as fatias.
        datasets: [{ data, backgroundColor: t.series, borderColor: t.surface, borderWidth: 2 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'right' }, tooltip },
      },
    };
    return new Chart(canvas, config);
  }

  const horizontal = spec.chartType === 'barH';
  const valueAxis = {
    beginAtZero: true,
    grid: { color: t.grid },
    border: { display: false },
    ticks: { callback: (v: string | number) => formatValue(spec, Number(v), true) },
  };
  const categoryAxis = { grid: { display: false } };

  if (spec.chartType === 'line') {
    const config: ChartConfiguration<'line'> = {
      type: 'line',
      data: {
        labels,
        datasets: [{ data, borderColor: t.series[0], backgroundColor: t.series[0], borderWidth: 2, pointRadius: 4 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        // Uma série só: o título já diz o que é, a legenda seria ruído.
        plugins: { legend: { display: false }, tooltip },
        scales: { x: categoryAxis, y: valueAxis },
      },
    };
    return new Chart(canvas, config);
  }

  const config: ChartConfiguration<'bar'> = {
    type: 'bar',
    data: {
      labels,
      datasets: [{ data, backgroundColor: t.series[0], borderRadius: 4, maxBarThickness: 48 }],
    },
    options: {
      indexAxis: horizontal ? 'y' : 'x',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip },
      scales: horizontal ? { x: valueAxis, y: categoryAxis } : { x: categoryAxis, y: valueAxis },
    },
  };
  return new Chart(canvas, config);
}
