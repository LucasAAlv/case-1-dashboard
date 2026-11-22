import type { PipefyClient } from '../pipefy/sdk';
import { parseChartSpecs, type ChartSpec } from './chart-spec';

/** Onde ficam as visões de cada usuário. */
export interface ChartRepository {
  /** Lança erro se a leitura falhar: lista vazia significa "nada salvo". */
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
  // Fila de gravações: adicionar e remover em sequência rápida não pode deixar
  // uma gravação antiga chegar depois da nova.
  let queue: Promise<unknown> = Promise.resolve();

  return {
    async load() {
      return parseChartSpecs(await p.get('pipe', 'private', KEY));
    },
    save(specs) {
      const value = JSON.stringify(specs);
      // O `p.set` resolve de forma inconsistente: o `.then` serve só como sinal de conclusão.
      const write = queue.then(() => p.set('pipe', 'private', KEY, value));
      queue = write.catch(() => undefined);
      return write.then(() => undefined);
    },
  };
}
