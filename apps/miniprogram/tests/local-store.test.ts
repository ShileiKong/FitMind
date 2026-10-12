import { expect, it } from 'vitest';
import { LocalStore, LOCAL_DATABASE_KEY } from '../src/local/store';
import { platformStore } from './local-fixtures';
const ctx = (key = 'one') => ({
  user_id: 'personal',
  request_id: key,
  idempotency_key: key,
  now_utc: '2026-10-11T10:00:00Z',
  timezone: 'Asia/Shanghai',
  reference_local_date: '2026-10-11',
});

it('persists a transaction and returns immutable reads in SQLite insertion order', () => {
  const platform = platformStore();
  const store = new LocalStore(platform);
  const first = { id: 'first', version: 1, nested: { amount: 1 } };
  store.transaction(() => {
    store.put('personal', 'example', first);
    store.put('personal', 'example', { id: 'second', version: 1 });
  });
  first.nested.amount = 99;
  store.get<any>('personal', 'example', 'first').nested.amount = 88;
  store.list<any>('personal', 'example')[1].nested.amount = 77;
  store.put('personal', 'example', {
    id: 'first',
    version: 2,
    nested: { amount: 2 },
  });
  const restarted = new LocalStore(platform);
  expect(
    restarted.list('personal', 'example').map((row: any) => row.id),
  ).toEqual(['second', 'first']);
  expect(restarted.get('personal', 'example', 'first')).toEqual({
    id: 'first',
    version: 2,
    nested: { amount: 2 },
  });
  expect(restarted.list('someone-else', 'example')).toEqual([]);
  expect(() => restarted.get('someone-else', 'example', 'first')).toThrow(
    /不存在/,
  );
});

it('rolls back both state and idempotency when durable storage fails', () => {
  const platform = platformStore();
  const store = new LocalStore(platform);
  platform.failWrites(true);
  expect(() =>
    store.mutate(ctx(), 'record', { amount: 350 }, () => {
      store.put('personal', 'example', { id: 'record', version: 1 });
      return { id: 'record' };
    }),
  ).toThrow(/保存/);
  expect(store.list('personal', 'example')).toHaveLength(0);
  platform.failWrites(false);
  let executions = 0;
  const write = () =>
    store.mutate(ctx(), 'record', { amount: 350 }, () => {
      executions++;
      store.put('personal', 'example', { id: 'record', version: 1 });
      return { id: 'record' };
    });
  expect(write()).toEqual({ id: 'record' });
  expect(
    new LocalStore(platform).mutate(ctx(), 'record', { amount: 350 }, () => {
      throw new Error('duplicated');
    }),
  ).toEqual({ id: 'record' });
  expect(executions).toBe(1);
  expect(() =>
    store.mutate(ctx(), 'record', { amount: 400 }, () => null),
  ).toThrow(/内容不同/);
});

it('journals the tool result with its mutation and never logs a rolled back tool', () => {
  const platform = platformStore();
  const store = new LocalStore(platform);
  const context = {
    ...ctx(),
    journal: { message_id: 'message', slot: 0, payload: '{"tool":"record"}' },
  };
  platform.failWrites(true);
  expect(() =>
    store.mutate(context, 'tool', {}, () => {
      store.put('personal', 'example', { id: 'record', version: 1 });
      return { id: 'record' };
    }),
  ).toThrow();
  expect(store.list('personal', 'command')).toHaveLength(0);
  platform.failWrites(false);
  store.mutate(context, 'tool', {}, () => {
    store.put('personal', 'example', { id: 'record', version: 1 });
    return { id: 'record' };
  });
  expect(
    new LocalStore(platform).get('personal', 'command', 'message:0'),
  ).toMatchObject({ message_id: 'message', slot: 0, result: { id: 'record' } });
});

it('rolls back throwing and thenable transactions without replacing corrupt data', () => {
  const platform = platformStore();
  const store = new LocalStore(platform);
  expect(() =>
    store.transaction(() => {
      store.put('personal', 'example', { id: 'temporary', version: 1 });
      throw new Error('stop');
    }),
  ).toThrow('stop');
  expect(store.list('personal', 'example')).toHaveLength(0);
  expect(() =>
    store.transaction(() => {
      store.put('personal', 'example', { id: 'temporary', version: 1 });
      return Promise.resolve();
    }),
  ).toThrow(/同步/);
  expect(store.list('personal', 'example')).toHaveLength(0);
  platform.values.set(LOCAL_DATABASE_KEY, '{broken');
  expect(() => new LocalStore(platform).list('personal', 'example')).toThrow(
    /损坏/,
  );
  expect(platform.values.get(LOCAL_DATABASE_KEY)).toBe('{broken');
});

it('commits databases larger than one wx storage item and preserves old chunks on failed manifest', () => {
  const platform = platformStore();
  let rejectManifest = false;
  const set = platform.setStorageSync.bind(platform);
  platform.setStorageSync = (key, value) => {
    if (
      Buffer.byteLength(
        typeof value === 'string' ? value : JSON.stringify(value),
        'utf8',
      ) >
      1024 * 1024
    )
      throw new Error('one item too large');
    if (rejectManifest && key === LOCAL_DATABASE_KEY)
      throw new Error('failed manifest');
    set(key, value);
  };
  const store = new LocalStore(platform);
  store.put('personal', 'example', {
    id: 'large',
    version: 1,
    text: '字'.repeat(400000),
  });
  expect(
    new LocalStore(platform).get<any>('personal', 'example', 'large').text,
  ).toHaveLength(400000);
  const primary = platform.values.get(LOCAL_DATABASE_KEY);
  rejectManifest = true;
  expect(() =>
    store.put('personal', 'example', {
      id: 'large',
      version: 2,
      text: '字'.repeat(450000),
    }),
  ).toThrow(/保存/);
  expect(store.get<any>('personal', 'example', 'large').version).toBe(1);
  expect(platform.values.get(LOCAL_DATABASE_KEY)).toBe(primary);
  expect(
    new LocalStore(platform).get<any>('personal', 'example', 'large').version,
  ).toBe(1);
  expect(
    [...platform.values.keys()].filter((key) => key.includes('.chunk.')),
  ).toHaveLength(4);
});

it('allows backup recovery from retained corruption and assigns a fresh cache epoch on import', () => {
  const platform = platformStore();
  const healthy = new LocalStore(platform);
  healthy.put('personal', 'example', { id: 'saved', version: 1 });
  const backup = healthy.exportBackup();
  const oldEpoch = healthy.cacheEpoch;
  platform.values.set(LOCAL_DATABASE_KEY, '{broken');
  const broken = new LocalStore(platform);
  expect(() => broken.list('personal', 'example')).toThrow(/损坏/);
  broken.importBackup(backup);
  expect(broken.get('personal', 'example', 'saved')).toMatchObject({
    id: 'saved',
  });
  expect(broken.cacheEpoch).not.toBe(oldEpoch);
  expect(new LocalStore(platform).cacheEpoch).toBe(broken.cacheEpoch);
  expect(JSON.parse(broken.exportBackup())).not.toHaveProperty('cache_epoch');
});

it('returns an already durable idempotent receipt when no more storage can be written', () => {
  const platform = platformStore();
  const store = new LocalStore(platform);
  const result = store.mutate(ctx(), 'record', { amount: 350 }, () => {
    store.put('personal', 'example', { id: 'record', version: 1 });
    return { id: 'record' };
  });
  const restart = new LocalStore(platform);
  platform.failWrites(true);
  expect(
    restart.mutate(ctx(), 'record', { amount: 350 }, () => {
      throw new Error('duplicate execution');
    }),
  ).toEqual(result);
});
