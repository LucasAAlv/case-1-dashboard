import type { Chart } from 'chart.js';
import { aggregate, type Aggregation, type Dimension } from '../analytics/aggregate';
import {
  AGGREGATIONS,
  CHART_TYPES,
  DIMENSIONS,
  MAX_CHARTS,
  MAX_LIMIT,
  defaultTitle,
  type ChartSpec,
  type ChartType,
} from '../charts/chart-spec';
import { MAX_DOUGHNUT_SLICES, formatValue, renderChart } from '../charts/render-chart';
import type { CardRecord } from '../domain/card';
import { h, options } from './dom';

export interface ViewHandlers {
  onAddChart(spec: Omit<ChartSpec, 'id'>): void;
  onRemoveChart(id: string): void;
  onSync(): void;
  onClearCache(): void;
}

export type StatusKind = 'info' | 'busy' | 'error';

/** Hoje no fuso do navegador (AAAA-MM-DD), para a situação de vencimento. */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Rosca: grupos + "Outros" + "(vazio)" não passam do número de cores categóricas. */
const DOUGHNUT_LIMIT = MAX_DOUGHNUT_SLICES - 2;

export class DashboardView {
  private readonly status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  private readonly progress = h('progress', { class: 'progress', max: 100, hidden: true });
  private readonly meta = h('p', { class: 'meta' });
  private readonly grid = h('section', { class: 'grid', 'aria-label': 'Visões' });
  private readonly syncButton = h('button', { type: 'button', class: 'secondary' }, 'Sincronizar agora');
  private readonly addButton = h('button', { type: 'submit' }, 'Adicionar visão');
  private charts = new Map<string, Chart>();

  constructor(
    private readonly root: HTMLElement,
    private readonly handlers: ViewHandlers,
  ) {
    this.root.replaceChildren(this.header(), this.builder(), this.grid);
  }

  private header() {
    const clear = h('button', { type: 'button', class: 'link' }, 'Limpar cache local');
    this.syncButton.addEventListener('click', () => this.handlers.onSync());
    clear.addEventListener('click', () => this.handlers.onClearCache());
    return h(
      'header',
      { class: 'top' },
      h('div', {}, h('h1', {}, 'Dashboard de Cards'), this.meta),
      h('div', { class: 'top-actions' }, this.status, this.progress, this.syncButton, clear),
    );
  }

  private builder() {
    const dimension = h('select', { name: 'dimension' }, ...options(DIMENSIONS, 'companyBase'));
    const aggregation = h('select', { name: 'aggregation' }, ...options(AGGREGATIONS, 'sum'));
    const chartType = h('select', { name: 'chartType' }, ...options(CHART_TYPES, 'bar'));
    const limit = h('input', { name: 'limit', type: 'number', min: 1, max: MAX_LIMIT, value: 10 });
    const title = h('input', { name: 'title', type: 'text', maxlength: 80, placeholder: 'Automático' });

    const form = h(
      'form',
      { class: 'builder', 'aria-label': 'Nova visão' },
      field('Dimensão', dimension),
      field('Métrica', aggregation),
      field('Gráfico', chartType),
      field('Máx. de grupos', limit),
      field('Título', title),
      this.addButton,
    );

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const type = chartType.value as ChartType;
      const requested = Math.min(Math.max(Number(limit.value) || 10, 1), MAX_LIMIT);
      const spec = {
        dimension: dimension.value as Dimension,
        aggregation: aggregation.value as Aggregation,
        chartType: type,
        limit: type === 'doughnut' ? Math.min(requested, DOUGHNUT_LIMIT) : requested,
      };
      this.handlers.onAddChart({ ...spec, title: title.value.trim() || defaultTitle(spec) });
      title.value = '';
    });
    return form;
  }

  setStatus(text: string, kind: StatusKind = 'info') {
    this.status.textContent = text;
    this.status.dataset.kind = kind;
    this.syncButton.disabled = kind === 'busy';
  }

  setProgress(loaded: number, total: number | null) {
    this.progress.hidden = total === null;
    if (total) this.progress.value = Math.min(100, Math.round((loaded / total) * 100));
  }

  setMeta(text: string) {
    this.meta.textContent = text;
  }

  /** Redesenha todas as visões a partir do cache em memória. */
  renderCharts(specs: readonly ChartSpec[], cards: readonly CardRecord[]) {
    for (const chart of this.charts.values()) chart.destroy();
    this.charts.clear();
    this.addButton.disabled = specs.length >= MAX_CHARTS;

    if (specs.length === 0) {
      this.grid.replaceChildren(
        h('p', { class: 'empty' }, 'Nenhuma visão ainda. Escolha dimensão, métrica e gráfico acima.'),
      );
      return;
    }

    const today = localToday();
    this.grid.replaceChildren(
      ...specs.map((spec) => {
        const rows = aggregate(cards, spec, { today });
        const canvas = h('canvas', { role: 'img', 'aria-label': spec.title });
        const remove = h('button', { type: 'button', class: 'link', 'aria-label': `Remover ${spec.title}` }, 'Remover');
        remove.addEventListener('click', () => this.handlers.onRemoveChart(spec.id));

        const card = h(
          'article',
          { class: 'chart-card' },
          h('header', {}, h('h2', {}, spec.title), remove),
          rows.length ? h('div', { class: 'chart-box' }, canvas) : h('p', { class: 'empty' }, 'Sem dados para esta visão.'),
          rows.length > 0 && dataTable(spec, rows),
        );
        if (rows.length) queueMicrotask(() => this.charts.set(spec.id, renderChart(canvas, spec, rows)));
        return card;
      }),
    );
  }
}

function field(label: string, control: HTMLElement) {
  return h('label', {}, h('span', {}, label), control);
}

/** Tabela com os mesmos números do gráfico: acessível e conferível. */
function dataTable(spec: ChartSpec, rows: ReturnType<typeof aggregate>) {
  return h(
    'details',
    { class: 'data' },
    h('summary', {}, 'Ver dados'),
    h(
      'table',
      {},
      h('thead', {}, h('tr', {}, h('th', {}, DIMENSIONS[spec.dimension]), h('th', {}, AGGREGATIONS[spec.aggregation]))),
      h('tbody', {}, ...rows.map((r) => h('tr', {}, h('td', {}, r.label), h('td', {}, formatValue(spec, r.value))))),
    ),
  );
}
