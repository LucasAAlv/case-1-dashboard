import { beforeEach, describe, expect, it } from 'vitest';
import { SyncEngine } from '../../src/sync/sync-engine';
import { FakePipe, MemoryStore, rawCard } from '../helpers/fake-pipe';

const range = (n: number, from = 1) => Array.from({ length: n }, (_, i) => rawCard(from + i));
const NOW = new Date('2026-11-19T12:00:00Z');

function engine(pipe: FakePipe, store: MemoryStore, now = NOW) {
  return new SyncEngine(pipe, store, { now: () => now, marginSeconds: 60 });
}

describe('SyncEngine: carga inicial', () => {
  let pipe: FakePipe;
  let store: MemoryStore;

  beforeEach(() => {
    pipe = new FakePipe(range(120), 50);
    store = new MemoryStore();
  });

  it('pagina o pipe inteiro uma vez e deixa o cache pronto', async () => {
    const result = await engine(pipe, store).sync();
    expect(result).toMatchObject({ mode: 'full', upserted: 120, deleted: 0, reconciled: false });
    // 1 cards_count + 3 páginas.
    expect(result.calls).toBe(4);
    expect(await store.count()).toBe(120);
    expect(store.state).toMatchObject({ phase: 'ready', cursor: null, reconciledPipeCount: 120 });
    expect(store.state?.watermark).toBe('2026-11-12T18:56:30Z');
  });

  it('salva o cursor a cada página e retoma de onde parou', async () => {
    pipe.failOnCall = 3; // cards_count, página 1, falha na página 2
    await expect(engine(pipe, store).sync()).rejects.toThrow('falha simulada');
    expect(await store.count()).toBe(50);
    expect(store.state).toMatchObject({ phase: 'full-load', cursor: '50' });

    pipe.failOnCall = null;
    pipe.calls = 0;
    const result = await engine(pipe, store).sync();
    // 1 cards_count + páginas 2 e 3: a página 1 não é baixada de novo.
    expect(result.calls).toBe(3);
    expect(await store.count()).toBe(120);
    expect(store.state?.phase).toBe('ready');
  });

  it('pula card inválido sem derrubar o sync', async () => {
    pipe.cards.push({ id: '999', updated_at: 'inválido', fields: [] });
    const result = await engine(pipe, store).sync();
    expect(result.skipped).toBe(1);
    expect(await store.count()).toBe(120);
  });

  it('informa o progresso da carga', async () => {
    const progress: number[] = [];
    await new SyncEngine(pipe, store, { now: () => NOW, onProgress: (p) => progress.push(p.loaded) }).sync();
    expect(progress).toEqual([50, 100, 120]);
  });
});

describe('SyncEngine: incremental', () => {
  let pipe: FakePipe;
  let store: MemoryStore;

  beforeEach(async () => {
    pipe = new FakePipe(range(120), 50);
    store = new MemoryStore();
    await engine(pipe, store).sync();
    pipe.calls = 0;
  });

  it('sem mudanças, custa 2 chamadas e não baixa o pipe de novo', async () => {
    const result = await engine(pipe, store).sync();
    expect(result).toMatchObject({ mode: 'incremental', calls: 2, upserted: 0, deleted: 0 });
  });

  it('busca só os cards alterados e faz upsert por id', async () => {
    pipe.update(7, '2026-11-19T11:30:00Z', '999');
    const result = await engine(pipe, store).sync();
    expect(result).toMatchObject({ mode: 'incremental', upserted: 1, calls: 2 });
    expect(await store.count()).toBe(120);
    expect(store.cards.get('7')?.totalValue).toBe(999);
    expect(store.state?.watermark).toBe('2026-11-19T11:30:00Z');
  });

  it('usa a marca d’água menos a margem no filtro', async () => {
    pipe.update(7, '2026-11-19T11:30:00Z', '1');
    await engine(pipe, store).sync();
    // Um card com updated_at 30 s antes da marca ainda entra, graças à margem de 60 s.
    pipe.update(8, '2026-11-19T11:29:30Z', '2');
    const result = await engine(pipe, store).sync();
    expect(store.cards.get('8')?.totalValue).toBe(2);
    expect(result.upserted).toBe(2); // o card 7 volta repetido: aceitável, upsert idempotente
  });

  it('traz cards novos', async () => {
    pipe.cards.push(rawCard(500, '2026-11-19T11:00:00Z'));
    const result = await engine(pipe, store).sync();
    expect(result.upserted).toBe(1);
    expect(await store.count()).toBe(121);
  });

  it('não avança a marca se o incremental cair no meio', async () => {
    for (let id = 1; id <= 60; id++) pipe.update(id, '2026-11-19T11:00:00Z', '5');
    const before = store.state?.watermark;
    pipe.failOnCall = 3; // cards_count, página 1, falha na página 2
    await expect(engine(pipe, store).sync()).rejects.toThrow();
    expect(store.state?.watermark).toBe(before);
  });
});

describe('SyncEngine: exclusões', () => {
  let pipe: FakePipe;
  let store: MemoryStore;

  beforeEach(async () => {
    pipe = new FakePipe(range(120), 50);
    store = new MemoryStore();
    await engine(pipe, store).sync();
    pipe.calls = 0;
  });

  it('reconcilia os ids quando o cards_count diverge do cache', async () => {
    pipe.cards = pipe.cards.filter((c) => c.id !== '42');
    const result = await engine(pipe, store).sync();
    expect(result).toMatchObject({ reconciled: true, deleted: 1 });
    // cards_count + incremental + 3 páginas de ids
    expect(result.calls).toBe(5);
    expect(store.cards.has('42')).toBe(false);
    expect(store.state?.reconciledPipeCount).toBe(119);
  });

  it('não reconcilia de novo se o cards_count não mudou desde a última reconciliação', async () => {
    // Usuário com visibilidade parcial: o pipe diz 130, mas ele só enxerga 120.
    pipe.reportedCount = 130;
    const first = await engine(pipe, store).sync();
    expect(first.reconciled).toBe(true);
    pipe.calls = 0;
    const second = await engine(pipe, store).sync();
    expect(second).toMatchObject({ reconciled: false, calls: 2 });
  });
});
