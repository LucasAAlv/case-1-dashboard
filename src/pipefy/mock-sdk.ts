/**
 * SDK falso para desenvolver fora da Pipefy (`npm run dev`).
 *
 * Fora do iframe não há `appID` e o SDK real não funciona. Este mock imita o
 * `allCards` (cursor, 50 por página, filtro `updated_at gte`), o `cards_count`,
 * o `me` e o `p.get`/`p.set`, com dados sintéticos parecidos com os do pipe do
 * case. Só é carregado em modo de desenvolvimento (ver `pipe-view.ts`).
 *
 * Parâmetros na URL: `?mockCards=20000&mockLatency=100&mockUser=u1`.
 */
import type { PipefyAppGlobal, PipefyClient, PipefyQueryResult } from './sdk';

interface MockCard {
  id: string;
  updated_at: string;
  fields: { field: { id: string }; value: string }[];
}

/** PRNG determinístico (mulberry32): os mesmos dados a cada recarga. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COMPANIES = [
  ['Acme', 'acme.com'],
  ['Massive Dynamic', 'massivedynamic.com'],
  ['Initech', 'initech.com'],
  ['Umbrella', 'umbrella.com'],
  ['Globex', 'globex.com'],
  ['Stark Industries', 'stark.com'],
] as const;
const SUFFIXES = ['LTDA', 'Holding', 'Group', 'EIRELI', 'S.A.'];
const PLACES = [
  ['Sao Paulo', 'SP'],
  ['Campinas', 'SP'],
  ['Curitiba', 'PR'],
  ['Londrina', 'PR'],
  ['Porto Alegre', 'RS'],
  ['Rio de Janeiro', 'RJ'],
  ['Belo Horizonte', 'MG'],
  ['Salvador', 'BA'],
  ['Recife', 'PE'],
  ['Florianopolis', 'SC'],
] as const;
const NAMES = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Fabio', 'Gabi', 'Hugo', 'Iris', 'Joao', 'Ursula', 'Wagner'];
const SURNAMES = ['Souza', 'Silva', 'Lima', 'Costa', 'Alves', 'Rocha'];

const pick = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length)]!;
const pad = (n: number) => String(n).padStart(2, '0');

function generate(count: number): MockCard[] {
  const r = rng(42);
  const start = Date.UTC(2026, 10, 1);
  const span = Date.UTC(2027, 9, 31) - start;
  return Array.from({ length: count }, (_, i) => {
    const [company, domain] = pick(r, COMPANIES);
    const [city, state] = pick(r, PLACES);
    const first = pick(r, NAMES);
    const last = pick(r, SURNAMES);
    const due = new Date(start + Math.floor(r() * span));
    const fields = [
      ['nome_contato', `${first} ${last}`],
      ['email', `${first.toLowerCase()}.${last.toLowerCase()}${i}@${domain}`],
      ['empresa', `${company} ${pick(r, SUFFIXES)}`],
      ['cidade', city],
      ['estado', state],
      ['valor_total', (Math.round(r() * 200_000_000) / 100).toString()],
      ['data_limite', `${pad(due.getUTCDate())}/${pad(due.getUTCMonth() + 1)}/${due.getUTCFullYear()}`],
    ].map(([id, value]) => ({ field: { id: id! }, value: value! }));
    // Mesma ordem variável de campos que a API real devolve.
    fields.sort(() => r() - 0.5);
    return { id: String(1_477_000_000 + i), updated_at: '2026-11-12T18:56:30Z', fields };
  });
}

function createMock(params: URLSearchParams): PipefyAppGlobal {
  const cards = generate(Number(params.get('mockCards') ?? 2000));
  const latency = Number(params.get('mockLatency') ?? 80);
  const userId = params.get('mockUser') ?? 'dev-user';
  const pageSize = 50;
  const sleep = () => new Promise((resolve) => setTimeout(resolve, latency));

  function allCards(query: string) {
    const after = query.match(/after: "([^"]*)"/)?.[1];
    const since = query.match(/operator: gte, value: "([^"]*)"/)?.[1];
    const onlyIds = !query.includes('fields');
    const matching = since ? cards.filter((c) => c.updated_at >= since) : cards;
    const start = after ? Number(atob(after)) : 0;
    const page = matching.slice(start, start + pageSize);
    const end = start + page.length;
    return {
      allCards: {
        pageInfo: { hasNextPage: end < matching.length, endCursor: page.length ? btoa(String(end)) : null },
        edges: page.map((c) => ({ node: onlyIds ? { id: c.id } : c })),
      },
    };
  }

  const client: PipefyClient = {
    app: { pipeId: '307434671' },
    async query<T>(query: string): Promise<PipefyQueryResult<T>> {
      await sleep();
      if (query.includes('allCards(')) return { data: allCards(query) as T };
      if (query.includes('cards_count')) return { data: { pipe: { cards_count: cards.length } } as T };
      if (query.includes('me {')) return { data: { me: { id: userId } } as T };
      return { errors: [{ message: 'Query não suportada pelo mock' }] };
    },
    async get(scope, visibility, key) {
      return localStorage.getItem(`mock:${userId}:${scope}:${visibility}:${key}`);
    },
    async set(scope, visibility, key, value) {
      localStorage.setItem(`mock:${userId}:${scope}:${visibility}:${key}`, value);
    },
  };

  // Atalho no console para simular uma edição: `__mockUpdateCard('1477000007')`.
  Object.assign(window, {
    __mockUpdateCard(id: string) {
      const card = cards.find((c) => c.id === id);
      if (!card) return false;
      card.updated_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
      const valor = card.fields.find((f) => f.field.id === 'valor_total');
      if (valor) valor.value = '999999.99';
      return true;
    },
    __mockDeleteCard(id: string) {
      const index = cards.findIndex((c) => c.id === id);
      if (index >= 0) cards.splice(index, 1);
      return index >= 0;
    },
  });

  return {
    init: () => client,
    initCall: () => undefined,
    render: (callback) => callback(),
    registerListener: () => undefined,
  };
}

export function installMockSdk(): void {
  window.PipefyApp = createMock(new URLSearchParams(location.search));
  console.info('[dashboard] SDK falso ativo: dados sintéticos, nada é lido da Pipefy.');
}
