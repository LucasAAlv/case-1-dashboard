import type { PipefyClient } from '../pipefy/sdk';
import { parseChartSpecs, type ChartSpec } from './chart-spec';

/** Onde ficam as visões de cada usuário. */
export interface ChartRepository {
  load(): Promise<ChartSpec[]>;
  save(specs: readonly ChartSpec[]): Promise<void>;
}

const KEY = 'charts';

/**
 * Guarda as definições no armazenamento do SDK, no escopo do pipe e com
 * visibilidade privada: cada usuário tem as próprias visões em cada pipe.
 * São poucos bytes por gráfico, dentro do recomendado para o `p.set`.
 */
export function createSdkChartRepository(p: PipefyClient): ChartRepository {
  return {
    async load() {
      try {
        return parseChartSpecs(await p.get('pipe', 'private', KEY));
      } catch {
        return [];
      }
    },
    async save(specs) {
      // O `p.set` resolve de forma inconsistente: o `.then` serve só como sinal de conclusão.
      await p.set('pipe', 'private', KEY, JSON.stringify(specs));
    },
  };
}
