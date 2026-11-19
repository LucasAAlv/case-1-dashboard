import { describe, expect, it } from 'vitest';
import { incrementalSince, nextWatermark, toUtcSeconds } from '../../src/sync/watermark';

describe('incrementalSince', () => {
  it('recua a marca d’água pela margem, em UTC', () => {
    expect(incrementalSince('2026-11-19T00:12:48Z', 60)).toBe('2026-11-19T00:11:48Z');
  });

  it('atravessa a virada do dia', () => {
    expect(incrementalSince('2026-11-19T00:00:10Z', 30)).toBe('2026-11-18T23:59:40Z');
  });
});

describe('nextWatermark', () => {
  it('na primeira vez, é o início do sync', () => {
    expect(nextWatermark(null, '2026-11-19T12:00:00Z')).toBe('2026-11-19T12:00:00Z');
  });

  it('avança para o início do sync mais recente', () => {
    expect(nextWatermark('2026-11-19T12:00:00Z', '2026-11-19T12:20:00Z')).toBe('2026-11-19T12:20:00Z');
  });

  it('nunca anda para trás', () => {
    expect(nextWatermark('2026-11-19T12:20:00Z', '2026-11-19T12:00:00Z')).toBe('2026-11-19T12:20:00Z');
  });
});

describe('toUtcSeconds', () => {
  it('formata em UTC sem milissegundos, como a API', () => {
    expect(toUtcSeconds(new Date('2026-11-18T21:00:00.789-03:00'))).toBe('2026-11-19T00:00:00Z');
  });
});
