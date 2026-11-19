/**
 * Conversões aplicadas uma única vez, na entrada do sync (decisão 6 do case):
 * o gráfico nunca reprocessa strings da API.
 */

type Maybe = string | null | undefined;

/** Texto aparado; vazio vira null. */
export function cleanText(value: Maybe): string | null {
  const text = value?.trim();
  return text ? text : null;
}

/** "1285947.3" -> 1285947.3. A API devolve o número como string com ponto decimal. */
export function parseDecimal(value: Maybe): number | null {
  const text = cleanText(value);
  if (text === null) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

const BR_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/** "27/02/2027" -> "2027-02-27". Datas impossíveis (31/02) viram null. */
export function parseBrDate(value: Maybe): string | null {
  const match = cleanText(value)?.match(BR_DATE);
  if (!match) return null;
  const [, dd, mm, yyyy] = match as unknown as [string, string, string, string];
  const day = Number(dd);
  const month = Number(mm);
  const year = Number(yyyy);
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return valid ? `${yyyy}-${mm}-${dd}` : null;
}

/** Normaliza um timestamp para UTC com resolução de segundo: "2026-11-19T00:12:48Z". */
export function toUtcIso(value: Maybe): string | null {
  const text = cleanText(value);
  if (text === null) return null;
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** "ursula@Acme.com" -> "acme.com". Dimensão derivada que junta as variações da empresa. */
export function emailDomain(value: Maybe): string | null {
  const email = cleanText(value);
  if (email === null) return null;
  const at = email.lastIndexOf('@');
  if (at <= 0) return null;
  const domain = email.slice(at + 1).toLowerCase();
  return domain ? domain : null;
}

// Sufixos societários, sempre como palavra inteira no fim do nome.
const COMPANY_SUFFIX =
  /[\s,]+(ltda\.?|s\.?\s?a\.?|s\/a|me|epp|eireli|holding|group|grupo|inc\.?|corp\.?)$/i;

/** "Massive Dynamic LTDA" -> "Massive Dynamic". Remove sufixos empilhados. */
export function companyBaseName(value: Maybe): string | null {
  let name = cleanText(value);
  if (name === null) return null;
  for (;;) {
    const next = name.replace(COMPANY_SUFFIX, '').trim();
    if (next === name || next === '') return name;
    name = next;
  }
}
