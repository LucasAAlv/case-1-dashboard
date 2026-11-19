import { describe, expect, it } from 'vitest';
import { incrementalSince, nextWatermark } from '../../src/sync/watermark';

describe('incrementalSince', () => {
  it('recua a marca d’água pela margem, em UTC', () => {
    expect(incrementalSince('2026-11-19T00:12:48Z', 60)).toBe('2026-11-19T00:11:48Z');
  });

  it('atravessa a virada do dia', () => {
    expect(incrementalSince('2026-11-19T00:00:10Z', 30)).toBe('2026-11-18T23:59:40Z');
  });
});

describe('nextWatermark', () => {
  const startedAt = '2026-11-19T12:00:00Z';

  it('mantém a marca quando o sync não viu nenhum card', () => {
    expect(nextWatermark('2026-11-19T10:00:00Z', null, startedAt)).toBe('2026-11-19T10:00:00Z');
  });

  it('avança para o maior updated_at visto', () => {
    expect(nextWatermark('2026-11-19T10:00:00Z', '2026-11-19T11:00:00Z', startedAt)).toBe(
      '2026-11-19T11:00:00Z',
    );
  });

  it('não passa do início do sync', () => {
    // Um card atualizado durante a paginação, numa página já lida, teria
    // updated_at >= início do sync. Limitar a marca ao início garante que ele
    // volte no próximo incremental, mesmo que outro card mais novo tenha sido visto.
    expect(nextWatermark('2026-11-19T10:00:00Z', '2026-11-19T12:00:05Z', startedAt)).toBe(startedAt);
  });

  it('nunca anda para trás', () => {
    expect(nextWatermark('2026-11-19T11:00:00Z', '2026-11-19T10:00:00Z', startedAt)).toBe(
      '2026-11-19T11:00:00Z',
    );
  });

  it('na carga inicial, parte de null', () => {
    expect(nextWatermark(null, '2026-11-12T18:57:00Z', startedAt)).toBe('2026-11-12T18:57:00Z');
    expect(nextWatermark(null, null, startedAt)).toBeNull();
  });
});
