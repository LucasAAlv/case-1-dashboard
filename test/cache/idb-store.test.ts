import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { cacheName, deleteCardStore, openCardStore } from '../../src/cache/idb-store';
import type { SyncState } from '../../src/cache/card-store';
import type { CardRecord } from '../../src/domain/card';

const PIPE = '307434671';

const card = (id: string, totalValue = 10): CardRecord => ({
  id,
  updatedAt: '2026-11-12T18:56:30Z',
  contactName: null,
  email: null,
  emailDomain: null,
  company: null,
  companyBase: null,
  city: null,
  state: 'PR',
  totalValue,
  dueDate: null,
  dueMonth: null,
});

const state = (cursor: string | null): SyncState => ({
  phase: 'full-load',
  cursor,
  startedAt: '2026-11-19T12:00:00Z',
  watermark: null,
  lastSyncAt: null,
  reconciledPipeCount: null,
});

const opened: { close(): void }[] = [];
async function open(userId: string) {
  const store = await openCardStore(userId, PIPE);
  opened.push(store);
  return store;
}

afterEach(async () => {
  for (const s of opened.splice(0)) s.close();
  await deleteCardStore('u1', PIPE);
  await deleteCardStore('u2', PIPE);
});

describe('IndexedDB store', () => {
  it('grava cards e estado juntos e faz upsert por id', async () => {
    const store = await open('u1');
    await store.commit({ upsert: [card('1'), card('2')], state: state('50') });
    await store.commit({ upsert: [card('2', 99)], state: state('100') });
    expect(await store.count()).toBe(2);
    expect((await store.all()).find((c) => c.id === '2')?.totalValue).toBe(99);
    expect(await store.loadState()).toMatchObject({ cursor: '100' });
  });

  it('remove ids', async () => {
    const store = await open('u1');
    await store.commit({ upsert: [card('1'), card('2')], state: state(null) });
    await store.commit({ remove: ['1'], state: state(null) });
    expect(await store.ids()).toEqual(['2']);
  });

  it('persiste entre aberturas, para retomar a carga', async () => {
    const first = await open('u1');
    await first.commit({ upsert: [card('1')], state: state('50') });
    first.close();
    const second = await open('u1');
    expect(await second.loadState()).toMatchObject({ cursor: '50' });
    expect(await second.count()).toBe(1);
  });

  it('isola os dados por usuário: um usuário nunca lê o cache de outro', async () => {
    const u1 = await open('u1');
    const u2 = await open('u2');
    await u1.commit({ upsert: [card('1')], state: state('50') });
    expect(await u2.count()).toBe(0);
    expect(await u2.loadState()).toBeNull();
  });

  it('recusa usuário ou pipe vazios', async () => {
    await expect(openCardStore('', PIPE)).rejects.toThrow();
    await expect(openCardStore('u1', '')).rejects.toThrow();
  });

  it('recusa ids com o separador do nome, para dois pares nunca darem o mesmo banco', () => {
    expect(() => cacheName('1:2', '3')).toThrow();
    expect(() => cacheName('1', '2:3')).toThrow();
    expect(() => cacheName('u1', 'abc')).toThrow();
    expect(cacheName('302573874', PIPE)).toBe(`pipefy-dashboard:302573874:${PIPE}`);
    expect(cacheName('dev-user', PIPE)).toBe(`pipefy-dashboard:dev-user:${PIPE}`);
  });

  it('não grava nada se uma gravação do commit falhar na hora', async () => {
    const store = await open('u1');
    await store.commit({ upsert: [card('1')], state: state('50') });
    const broken = { ...card('3'), id: undefined } as unknown as CardRecord;
    await expect(store.commit({ upsert: [card('2'), broken], state: state('100') })).rejects.toThrow();
    expect(await store.ids()).toEqual(['1']);
    expect(await store.loadState()).toMatchObject({ cursor: '50' });
  });
});
