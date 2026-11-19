import { describe, expect, it } from 'vitest';
import {
  companyBaseName,
  emailDomain,
  parseBrDate,
  parseDecimal,
} from '../../src/domain/normalize';

describe('parseDecimal', () => {
  it('converte a string com ponto decimal que a API devolve', () => {
    expect(parseDecimal('1285947.3')).toBe(1285947.3);
    expect(parseDecimal('272416.95')).toBe(272416.95);
    expect(parseDecimal(' 10 ')).toBe(10);
  });

  it('devolve null para vazio, nulo ou texto não numérico', () => {
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('   ')).toBeNull();
    expect(parseDecimal(null)).toBeNull();
    expect(parseDecimal(undefined)).toBeNull();
    expect(parseDecimal('abc')).toBeNull();
    expect(parseDecimal('12abc')).toBeNull();
    expect(parseDecimal('Infinity')).toBeNull();
  });
});

describe('parseBrDate', () => {
  it('converte DD/MM/AAAA para data ISO', () => {
    expect(parseBrDate('27/02/2027')).toBe('2027-02-27');
    expect(parseBrDate('01/11/2026')).toBe('2026-11-01');
  });

  it('rejeita datas impossíveis e formatos errados', () => {
    expect(parseBrDate('31/02/2027')).toBeNull();
    expect(parseBrDate('2027-02-27')).toBeNull();
    expect(parseBrDate('27/2/2027')).toBeNull();
    expect(parseBrDate('')).toBeNull();
    expect(parseBrDate(null)).toBeNull();
  });

  it('aceita 29/02 só em ano bissexto', () => {
    expect(parseBrDate('29/02/2028')).toBe('2028-02-29');
    expect(parseBrDate('29/02/2027')).toBeNull();
  });
});

describe('emailDomain', () => {
  it('extrai o domínio em minúsculas', () => {
    expect(emailDomain('ursula.souza4013@acme.com')).toBe('acme.com');
    expect(emailDomain('X@Massive-Dynamic.COM')).toBe('massive-dynamic.com');
  });

  it('devolve null para e-mail inválido ou vazio', () => {
    expect(emailDomain('sem-arroba')).toBeNull();
    expect(emailDomain('nome@')).toBeNull();
    expect(emailDomain('')).toBeNull();
    expect(emailDomain(null)).toBeNull();
  });
});

describe('companyBaseName', () => {
  it('remove o sufixo societário para juntar as variações da mesma empresa', () => {
    expect(companyBaseName('Acme Holding')).toBe('Acme');
    expect(companyBaseName('Acme EIRELI')).toBe('Acme');
    expect(companyBaseName('Acme Group')).toBe('Acme');
    expect(companyBaseName('Massive Dynamic LTDA')).toBe('Massive Dynamic');
    expect(companyBaseName('Initech S.A.')).toBe('Initech');
    expect(companyBaseName('Initech S/A')).toBe('Initech');
    expect(companyBaseName('Umbrella Ltda.')).toBe('Umbrella');
    expect(companyBaseName('Padaria Silva ME')).toBe('Padaria Silva');
  });

  it('remove sufixos empilhados e ignora caixa', () => {
    expect(companyBaseName('Acme Group Holding')).toBe('Acme');
    expect(companyBaseName('acme ltda')).toBe('acme');
  });

  it('não corta palavras que só contêm o sufixo', () => {
    expect(companyBaseName('Mega Store')).toBe('Mega Store');
    expect(companyBaseName('Groupon')).toBe('Groupon');
  });

  it('mantém o nome se ele for só o sufixo, e devolve null para vazio', () => {
    expect(companyBaseName('Holding')).toBe('Holding');
    expect(companyBaseName('  ')).toBeNull();
    expect(companyBaseName(null)).toBeNull();
  });
});
