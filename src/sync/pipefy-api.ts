import type { RawCard } from '../domain/card-parser';
import type { GraphQLClient } from './graphql-client';

/** Máximo aceito pelo `allCards` (testado): uma carga completa de 20 mil cards custa ~400 chamadas. */
export const PAGE_SIZE = 50;

export interface CardsPage<T> {
  items: T[];
  hasNextPage: boolean;
  endCursor: string | null;
}

/** As três leituras de que o sync precisa. Isola o GraphQL do motor de sync. */
export interface PipefyApi {
  /** Página de cards, opcionalmente só os alterados desde `updatedSince` (UTC). */
  cardsPage(args: { after: string | null; updatedSince: string | null }): Promise<CardsPage<RawCard>>;
  /** Página só com ids, para reconciliar exclusões. */
  cardIdsPage(after: string | null): Promise<CardsPage<string>>;
  cardsCount(): Promise<number>;
}

interface AllCardsResponse<N> {
  allCards: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: { node: N }[];
  };
}

/** Literal GraphQL seguro: JSON e GraphQL escapam strings do mesmo jeito. */
const str = (value: string) => JSON.stringify(value);

/**
 * Os valores entram como literais, e não como variáveis, porque o nome do tipo
 * do `filter` no schema não foi verificado. O formato abaixo foi testado no
 * GraphiQL. Todo valor dinâmico passa por `str` ou pela validação do pipeId.
 */
function allCardsQuery(pipeId: string, node: string, after: string | null, updatedSince: string | null) {
  const args = [`pipeId: ${pipeId}`, `first: ${PAGE_SIZE}`];
  if (after !== null) args.push(`after: ${str(after)}`);
  if (updatedSince !== null) {
    args.push(`filter: { field: "updated_at", operator: gte, value: ${str(updatedSince)} }`);
  }
  return `{ allCards(${args.join(', ')}) { pageInfo { hasNextPage endCursor } edges { node { ${node} } } } }`;
}

function toPage<N, T>(response: AllCardsResponse<N>, map: (node: N) => T): CardsPage<T> {
  const { pageInfo, edges } = response.allCards;
  return { items: edges.map((e) => map(e.node)), hasNextPage: pageInfo.hasNextPage, endCursor: pageInfo.endCursor };
}

export function createPipefyApi(client: GraphQLClient, pipeId: string): PipefyApi {
  if (!/^\d+$/.test(pipeId)) throw new Error(`pipeId inválido: ${pipeId}`);

  return {
    async cardsPage({ after, updatedSince }) {
      const query = allCardsQuery(pipeId, 'id updated_at fields { field { id } value }', after, updatedSince);
      return toPage(await client.request<AllCardsResponse<RawCard>>(query), (node) => node);
    },

    async cardIdsPage(after) {
      const query = allCardsQuery(pipeId, 'id', after, null);
      return toPage(await client.request<AllCardsResponse<{ id: string }>>(query), (node) => node.id);
    },

    async cardsCount() {
      const data = await client.request<{ pipe: { cards_count: number } }>(`{ pipe(id: ${pipeId}) { cards_count } }`);
      return data.pipe.cards_count;
    },
  };
}
