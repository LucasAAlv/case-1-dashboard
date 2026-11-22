/**
 * Marca d'água do sync incremental (D4 em docs/decisoes.md).
 *
 * A marca é o instante em que o último sync concluído começou. Tudo que foi
 * alterado antes desse instante já estava visível quando o sync paginou o pipe;
 * o que mudou durante ou depois tem `updated_at` posterior e entra no próximo.
 *
 * O filtro usa `updated_at gte <marca - margem>`. A margem cobre diferença de
 * relógio entre o navegador e a Pipefy e gravações que ficam visíveis com atraso.
 * O upsert por id torna inofensivo baixar alguns cards repetidos; perder um não é aceitável.
 *
 * Por que não "último updated_at visto": na base do case, os 20 mil cards têm
 * updated_at dentro do mesmo minuto. A marca ficaria parada nesse minuto e todo
 * incremental baixaria de novo os cards dentro da margem (ver docs/decisoes.md).
 */

/** `Date` ou epoch em ms -> ISO em UTC com resolução de segundo, no formato da API. */
export function toUtcSeconds(date: Date | number): string {
  return new Date(date).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Valor do filtro `updated_at gte` para o próximo incremental. */
export function incrementalSince(watermark: string, marginSeconds: number): string {
  return toUtcSeconds(Date.parse(watermark) - marginSeconds * 1000);
}

/** Próxima marca depois de um sync concluído. Nunca anda para trás (relógio ajustado, por exemplo). */
export function nextWatermark(current: string | null, syncStartedAt: string): string {
  return current !== null && current > syncStartedAt ? current : syncStartedAt;
}
