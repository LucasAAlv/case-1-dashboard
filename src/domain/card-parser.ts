import type { CardRecord } from './card';
import {
  cleanText,
  companyBaseName,
  emailDomain,
  parseBrDate,
  parseDecimal,
  toUtcIso,
} from './normalize';

/** Card como vem do `allCards`. A ordem de `fields` muda de card para card. */
export interface RawCard {
  id: string;
  updated_at: string;
  fields?: ReadonlyArray<{ field: { id: string }; value: string | null }> | null;
}

export class CardParseError extends Error {
  override name = 'CardParseError';
}

/** Converte o card cru da API no registro normalizado que vai para o cache. */
export function parseCard(raw: RawCard): CardRecord {
  const id = cleanText(raw.id);
  if (id === null) throw new CardParseError('Card sem id');
  const updatedAt = toUtcIso(raw.updated_at);
  if (updatedAt === null) throw new CardParseError(`Card ${id} com updated_at inválido`);

  // Mapeia pelo field.id: nunca confiar na posição.
  const values = new Map<string, string | null>();
  for (const f of raw.fields ?? []) values.set(f.field.id, f.value);
  const get = (fieldId: string) => values.get(fieldId);

  const email = cleanText(get('email'));
  const company = cleanText(get('empresa'));
  const dueDate = parseBrDate(get('data_limite'));

  return {
    id,
    updatedAt,
    contactName: cleanText(get('nome_contato')),
    email,
    emailDomain: emailDomain(email),
    company,
    companyBase: companyBaseName(company),
    city: cleanText(get('cidade')),
    state: cleanText(get('estado')),
    totalValue: parseDecimal(get('valor_total')),
    dueDate,
    dueMonth: dueDate?.slice(0, 7) ?? null,
  };
}
