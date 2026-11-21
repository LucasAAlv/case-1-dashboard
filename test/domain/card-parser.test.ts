import { describe, expect, it } from 'vitest';
import { parseCard, type RawCard } from '../../src/domain/card-parser';

// Formato real devolvido por `allCards` (validado no GraphiQL em 19/11/2026).
const raw: RawCard = {
  id: '1477895237',
  updated_at: '2026-11-19T00:12:48Z',
  fields: [
    { field: { id: 'cidade' }, value: 'Porto Alegre' },
    { field: { id: 'nome_contato' }, value: 'Ursula Souza' },
    { field: { id: 'email' }, value: 'ursula.souza4013@acme.com' },
    { field: { id: 'empresa' }, value: 'Acme Holding' },
    { field: { id: 'estado' }, value: 'RS' },
    { field: { id: 'valor_total' }, value: '1285947.3' },
    { field: { id: 'data_limite' }, value: '27/02/2027' },
  ],
};

describe('parseCard', () => {
  it('normaliza o card: número, data ISO e dimensões derivadas', () => {
    expect(parseCard(raw)).toEqual({
      id: '1477895237',
      updatedAt: '2026-11-19T00:12:48Z',
      contactName: 'Ursula Souza',
      email: 'ursula.souza4013@acme.com',
      emailDomain: 'acme.com',
      company: 'Acme Holding',
      companyBase: 'Acme',
      city: 'Porto Alegre',
      state: 'RS',
      totalValue: 1285947.3,
      dueDate: '2027-02-27',
      dueMonth: '2027-02',
    });
  });

  it('mapeia pelo field.id, não pela posição', () => {
    const reversed: RawCard = { ...raw, fields: [...raw.fields!].reverse() };
    expect(parseCard(reversed)).toEqual(parseCard(raw));
  });

  it('trata campo ausente, vazio ou nulo como null sem quebrar', () => {
    const card = parseCard({
      id: '1',
      updated_at: '2026-11-12T18:56:00Z',
      fields: [
        { field: { id: 'email' }, value: '' },
        { field: { id: 'valor_total' }, value: null },
        { field: { id: 'cidade' }, value: '   ' },
      ],
    });
    expect(card).toMatchObject({
      email: null,
      emailDomain: null,
      totalValue: null,
      city: null,
      company: null,
      companyBase: null,
      dueDate: null,
      dueMonth: null,
    });
  });

  it('aceita card sem a lista de fields', () => {
    expect(parseCard({ id: '2', updated_at: '2026-11-12T18:56:00Z', fields: null }).state).toBeNull();
  });

  it('ignora campos desconhecidos', () => {
    const card = parseCard({ ...raw, fields: [...raw.fields!, { field: { id: 'novo' }, value: 'x' }] });
    expect(card).toEqual(parseCard(raw));
  });

  it('normaliza updated_at para UTC', () => {
    expect(parseCard({ ...raw, updated_at: '2026-11-18T21:00:00-03:00' }).updatedAt).toBe(
      '2026-11-19T00:00:00Z',
    );
  });

  it('rejeita card sem id ou sem updated_at válido', () => {
    expect(() => parseCard({ ...raw, id: '' })).toThrow();
    expect(() => parseCard({ ...raw, updated_at: 'ontem' })).toThrow();
  });
});
