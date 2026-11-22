import { beforeEach, describe, expect, it } from 'vitest';
import { SyncEngine } from '../../../src/sync/sync-engine';
import { FakePipe, MemoryStore, rawCard } from '../helpers/fake-pipe';

const range = (n: number, from = 1) => Array.from({ length: n }, (_, i) => rawCard(from + i));

/** Relógio controlado pelo teste. */
class Clock {
  constructor(public current = new Date('2026-11-19T12:00:00Z')) {}
  at(iso: string) {
    this.current = new Date(iso);
    return this;
  }
  now = () => this.current;
}

function engine(pipe: FakePipe, store: MemoryStore, clock: Clock) {
  return new SyncEngine(pipe, store, { now: clock.now, marginSeconds: 60, userId: 'u1' });
}

describe('SyncEngine: carga inicial', () => {
  let pipe: FakePipe;
  let store: MemoryStore;
  const clock = new Clock();

  beforeEach(() => {
    pipe = new FakePipe(range(120), 50);
    store = new MemoryStore();
    clock.at('2026-11-19T12:00:00Z');
  });

  it('pagina o pipe inteiro uma vez e deixa o cache pronto', async () => {
    const result = await engine(pipe, store, clock).sync();
    expect(result).toMatchObject({ mode: 'full', upserted: 120, deleted: 0, reconciled: false });
    // 1 cards_count + 3 páginas.
    expect(result.calls).toBe(4);
    expect(await store.count()).toBe(120);
    expect(store.state).toMatchObject({
      phase: 'ready',
      cursor: null,
      reconciledPipeCount: 120,
      watermark: '2026-11-19T12:00:00Z',
    });
  });

  it('salva o cursor a cada página e retoma de onde parou', async () => {
    pipe.failOnCall = 3; // cards_count, página 1, falha na página 2
    await expect(engine(pipe, store, clock).sync()).rejects.toThrow('falha simulada');
    expect(await store.count()).toBe(50);
    expect(store.state).toMatchObject({ phase: 'full-load', cursor: '50' });

    pipe.failOnCall = null;
    pipe.calls = 0;
    const result = await engine(pipe, store, clock.at('2026-11-19T13:00:00Z')).sync();
    // 1 cards_count + páginas 2 e 3: a página 1 não é baixada de novo.
    expect(result.calls).toBe(3);
    expect(await store.count()).toBe(120);
    // A marca vem do início da primeira tentativa: o que mudou entre as duas
    // tentativas, numa página já lida, volta no incremental.
    expect(store.state).toMatchObject({ phase: 'ready', watermark: '2026-11-19T12:00:00Z' });
  });

  it('na carga retomada, uma exclusão entre as tentativas é reconciliada', async () => {
    pipe.failOnCall = 3;
    await expect(engine(pipe, store, clock).sync()).rejects.toThrow();
    // O card 1 já está no cache e é excluído antes da retomada.
    pipe.cards = pipe.cards.filter((c) => c.id !== '1');
    pipe.failOnCall = null;
    const result = await engine(pipe, store, clock).sync();
    expect(result).toMatchObject({ reconciled: true, deleted: 1 });
    expect(store.cards.has('1')).toBe(false);
  });

  it('falha, em vez de encerrar, se a API disser que há mais páginas sem dar cursor', async () => {
    pipe.dropCursor = true;
    await expect(engine(pipe, store, clock).sync()).rejects.toThrow(/cursor/);
    expect(store.state?.phase).not.toBe('ready');
  });

  it('aborta sem gravar nada se a sessão da Pipefy mudou de usuário', async () => {
    pipe.userId = 'outro';
    await expect(engine(pipe, store, clock).sync()).rejects.toThrow(/usuário/);
    expect(await store.count()).toBe(0);
    expect(store.state).toBeNull();
  });

  it('pula card inválido sem derrubar o sync', async () => {
    pipe.cards.push({ id: '999', updated_at: 'inválido', fields: [] });
    const result = await engine(pipe, store, clock).sync();
    expect(result.skipped).toBe(1);
    expect(await store.count()).toBe(120);
  });

  it('informa o progresso da carga', async () => {
    const progress: number[] = [];
    await new SyncEngine(pipe, store, { now: clock.now, onProgress: (p) => progress.push(p.loaded) }).sync();
    expect(progress).toEqual([50, 100, 120]);
  });
});

describe('SyncEngine: incremental', () => {
  let pipe: FakePipe;
  let store: MemoryStore;
  const clock = new Clock();

  beforeEach(async () => {
    pipe = new FakePipe(range(120), 50);
    store = new MemoryStore();
    await engine(pipe, store, clock.at('2026-11-19T12:00:00Z')).sync();
    pipe.calls = 0;
  });

  it('sem mudanças, custa 2 chamadas e não baixa o pipe de novo', async () => {
    const result = await engine(pipe, store, clock.at('2026-11-19T12:10:00Z')).sync();
    expect(result).toMatchObject({ mode: 'incremental', calls: 2, upserted: 0, deleted: 0 });
    expect(store.state?.watermark).toBe('2026-11-19T12:10:00Z');
  });

  it('busca só os cards alterados e faz upsert por id', async () => {
    pipe.update(7, '2026-11-19T12:05:00Z', '999');
    const result = await engine(pipe, store, clock.at('2026-11-19T12:10:00Z')).sync();
    expect(result).toMatchObject({ mode: 'incremental', upserted: 1, calls: 2 });
    expect(await store.count()).toBe(120);
    expect(store.cards.get('7')?.totalValue).toBe(999);
  });

  it('a margem recupera um card gravado pouco antes do início do sync anterior', async () => {
    // Gravado às 12:09:30, mas só visível depois que o sync das 12:10 terminou.
    await engine(pipe, store, clock.at('2026-11-19T12:10:00Z')).sync();
    pipe.update(8, '2026-11-19T12:09:30Z', '2');
    const result = await engine(pipe, store, clock.at('2026-11-19T12:20:00Z')).sync();
    expect(result.upserted).toBe(1);
    expect(store.cards.get('8')?.totalValue).toBe(2);
  });

  it('a marca não fica presa quando muitos cards têm o mesmo updated_at', async () => {
    // Todos os cards da base têm updated_at no mesmo minuto: o incremental
    // não pode baixá-los de novo.
    const result = await engine(pipe, store, clock.at('2026-11-19T12:10:00Z')).sync();
    expect(result.upserted).toBe(0);
  });

  it('traz cards novos', async () => {
    pipe.cards.push(rawCard(500, '2026-11-19T12:05:00Z'));
    const result = await engine(pipe, store, clock.at('2026-11-19T12:10:00Z')).sync();
    expect(result.upserted).toBe(1);
    expect(await store.count()).toBe(121);
  });

  it('não reconcilia por causa de um card criado entre o cards_count e o incremental', async () => {
    pipe.beforeCardsPage = () => {
      if (!pipe.cards.some((c) => c.id === '500')) pipe.cards.push(rawCard(500, '2026-11-19T12:09:00Z'));
    };
    const result = await engine(pipe, store, clock.at('2026-11-19T12:10:00Z')).sync();
    // status + incremental + status de novo para confirmar a divergência
    expect(result).toMatchObject({ reconciled: false, upserted: 1, calls: 3 });
  });

  it('não avança a marca se o incremental cair no meio', async () => {
    for (let id = 1; id <= 60; id++) pipe.update(id, '2026-11-19T12:05:00Z', '5');
    pipe.failOnCall = 3; // cards_count, página 1, falha na página 2
    await expect(engine(pipe, store, clock.at('2026-11-19T12:10:00Z')).sync()).rejects.toThrow();
    expect(store.state?.watermark).toBe('2026-11-19T12:00:00Z');
  });
});

describe('SyncEngine: exclusões', () => {
  let pipe: FakePipe;
  let store: MemoryStore;
  const clock = new Clock();

  beforeEach(async () => {
    pipe = new FakePipe(range(120), 50);
    store = new MemoryStore();
    await engine(pipe, store, clock.at('2026-11-19T12:00:00Z')).sync();
    pipe.calls = 0;
    clock.at('2026-11-19T12:10:00Z');
  });

  it('reconcilia os ids quando o cards_count diverge do cache', async () => {
    pipe.cards = pipe.cards.filter((c) => c.id !== '42');
    const result = await engine(pipe, store, clock).sync();
    expect(result).toMatchObject({ reconciled: true, deleted: 1 });
    // status + incremental + 3 páginas da reconciliação
    expect(result.calls).toBe(5);
    expect(store.cards.has('42')).toBe(false);
    expect(store.state?.reconciledPipeCount).toBe(119);
  });

  it('quando reconcilia, também recupera card que falta no cache com updated_at antigo', async () => {
    // O filtro por updated_at nunca traria o card 42 de volta. Quando a
    // contagem muda (aqui, duas exclusões), a reconciliação corrige os dois lados.
    store.cards.delete('42');
    pipe.cards = pipe.cards.filter((c) => c.id !== '43' && c.id !== '44');
    const result = await engine(pipe, store, clock).sync();
    expect(result).toMatchObject({ reconciled: true, deleted: 2, calls: 5 });
    expect(store.cards.has('42')).toBe(true);
    expect(await store.count()).toBe(118);
  });

  it('não reconcilia de novo se o cards_count não mudou desde a última reconciliação', async () => {
    // Usuário com visibilidade parcial: o pipe diz 130, mas ele só enxerga 120.
    pipe.reportedCount = 130;
    const first = await engine(pipe, store, clock).sync();
    expect(first.reconciled).toBe(true);
    pipe.calls = 0;
    const second = await engine(pipe, store, clock.at('2026-11-19T12:20:00Z')).sync();
    expect(second).toMatchObject({ reconciled: false, calls: 2 });
  });
});
