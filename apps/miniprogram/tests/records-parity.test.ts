import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../../api/src/app';
import { MiniClient } from '../src/lib/client';

let app: any, db: DatabaseSync, c: MiniClient, definition: any;
let loseNextMutation: boolean, rejectRecordRead: boolean;
let navigation: { type: string; url?: string }[];
beforeEach(async () => {
  vi.resetModules();
  loseNextMutation = false;
  rejectRecordRead = false;
  navigation = [];
  db = new DatabaseSync(':memory:');
  app = await createApp({
    db,
    clock: () => new Date('2026-10-11T10:00:00Z'),
    access_token: 'test-token',
    media_root: 'data/test-media',
  });
  const store = new Map();
  c = new MiniClient({
    getStorageSync: (k: string) => structuredClone(store.get(k)),
    setStorageSync: (k: string, value: any) =>
      store.set(k, structuredClone(value)),
    removeStorageSync: (k: string) => store.delete(k),
    request: (o: any) => {
      if (
        rejectRecordRead &&
        o.method === 'GET' &&
        new URL(o.url).pathname.includes('/records/')
      ) {
        o.fail({});
        return;
      }
      void app
        .inject({
          method: o.method,
          url: new URL(o.url).pathname + new URL(o.url).search,
          headers: o.header,
          payload: o.data,
        })
        .then((r: any) => {
          if (loseNextMutation && ['POST', 'PATCH'].includes(o.method)) {
            loseNextMutation = false;
            o.fail({});
          } else o.success({ statusCode: r.statusCode, data: r.json() });
        });
    },
    uploadFile: () => {},
  });
  await c.connect({ base_url: 'https://fit.test', token: 'test-token' });
  vi.stubGlobal('getApp', () => ({ client: c }));
  vi.stubGlobal('getCurrentPages', () => [{ route: 'pages/editor/index' }]);
  vi.stubGlobal('Page', (p: any) => {
    definition = p;
  });
  vi.stubGlobal('wx', {
    showToast: () => {},
    showModal: (o: any) => o.success({ confirm: true }),
    navigateBack: () => navigation.push({ type: 'back' }),
    navigateTo: (o: any) => navigation.push({ type: 'navigate', url: o.url }),
    switchTab: (o: any) => navigation.push({ type: 'tab', url: o.url }),
  });
});
afterEach(async () => {
  await app.close();
  db.close();
  vi.unstubAllGlobals();
});
function page() {
  return {
    ...definition,
    data: structuredClone(definition.data),
    setData(values: any) {
      for (const [key, value] of Object.entries(values)) {
        const parts = key.split('.');
        let target: any = this.data;
        for (const part of parts.slice(0, -1))
          target = target[part] ?? (target[part] = {});
        target[parts.at(-1)!] = value;
      }
    },
  };
}
const input = (p: any, field: string, value: string) =>
  p.input({ currentTarget: { dataset: { field } }, detail: { value } });
async function editor(mode: string, id?: string) {
  await import('../src/pages/editor/index');
  const p = page();
  p.onLoad({ mode, id });
  await p.load();
  return p;
}
const nutrition = {
  calories_kcal: 200,
  carbs_g: 30,
  protein_g: 10,
  fat_g: null,
};
it('profile shows the latest weight by occurrence date and retains historical targets', async () => {
  await c.mutate('/records', {
    kind: 'body',
    metric: 'weight_kg',
    value: 71,
    local_date: '2026-10-11',
  });
  await c.mutate('/records', {
    kind: 'body',
    metric: 'weight_kg',
    value: 72,
    local_date: '2026-10-09',
  });
  const a = await c.mutate('/targets/drafts', {
    effective_from: '2026-10-11',
    water_ml: 2000,
    ...nutrition,
  });
  await c.mutate('/targets/' + a.id + '/confirm', {
    expected_version: a.version,
  });
  const b = await c.mutate('/targets/drafts', {
    effective_from: '2026-10-11',
    water_ml: 2500,
    ...nutrition,
  });
  await c.mutate('/targets/' + b.id + '/confirm', {
    expected_version: b.version,
  });
  await import('../src/pages/profile/index');
  const p = page();
  await p.load();
  expect(p.data.latest.value).toBe(71);
  expect(p.data.points.map((v: any) => v.local_date)).toEqual([
    '2026-10-09',
    '2026-10-11',
  ]);
  expect(p.data.targets.some((t: any) => t.status === 'superseded')).toBe(true);
  p.openSettings();
  p.openEditor({ currentTarget: { dataset: { mode: 'body' } } });
  expect(navigation).toEqual([
    { type: 'navigate', url: '/pages/settings/index' },
    { type: 'navigate', url: '/pages/editor/index?mode=body' },
  ]);
});
it('water editor honors an entered occurrence date and updates that day balance', async () => {
  const p = await editor('water');
  input(p, 'local_date', '2026-10-09');
  input(p, 'amount_ml', '350');
  await p.save();
  const r = await c.request('GET', '/records');
  expect(r.items[0]).toMatchObject({
    kind: 'water',
    amount_ml: 350,
    local_date: '2026-10-09',
  });
  expect(
    (await c.request('GET', '/days/2026-10-09/summary')).water_ml.known_total,
  ).toBe(350);
  expect(navigation).toEqual([{ type: 'back' }]);
});
it('food estimates reject missing assumptions and preserve unknown nutrition as null', async () => {
  const p = await editor('food');
  input(p, 'name', '米饭');
  input(p, 'calories_kcal', '200');
  await p.save();
  expect(p.data.error).toContain('估算');
  expect(c.pending()).toHaveLength(0);
  input(p, 'assumptions', '熟米饭约150g');
  await p.save();
  expect((await c.request('GET', '/records')).items[0]).toMatchObject({
    source: 'estimate',
    assumptions: '熟米饭约150g',
    nutrition: {
      calories_kcal: 200,
      carbs_g: null,
      protein_g: null,
      fat_g: null,
    },
  });
});
it('label editor submits basis nutrition and the server scales the consumed amount', async () => {
  const p = await editor('food');
  input(p, 'name', '牛奶');
  input(p, 'source', 'label');
  input(p, 'basis_unit', 'ml');
  input(p, 'basis_quantity', '100');
  input(p, 'consumed_quantity', '250');
  input(p, 'calories_kcal', '46');
  input(p, 'protein_g', '3');
  await p.save();
  expect((await c.request('GET', '/records')).items[0]).toMatchObject({
    source: 'label',
    nutrition: {
      calories_kcal: 115,
      carbs_g: null,
      protein_g: 7.5,
      fat_g: null,
    },
    label: {
      nutrition_per_basis: { calories_kcal: 46, protein_g: 3, fat_g: null },
      consumed_unit: 'ml',
    },
  });
});
it('correction loads the original label basis and patches its exact version', async () => {
  const r = await c.mutate('/records', {
    kind: 'food',
    name: '牛奶',
    source: 'label',
    nutrition,
    label: {
      basis_quantity: 100,
      basis_unit: 'ml',
      consumed_quantity: 250,
      consumed_unit: 'ml',
      nutrition_per_basis: nutrition,
    },
  });
  const p = await editor('food', r.entity.id);
  expect(p.data.form.calories_kcal).toBe('200');
  expect(p.data.form.fat_g).toBe('');
  input(p, 'consumed_quantity', '150');
  await p.save();
  expect(await c.request('GET', '/records/' + r.entity.id)).toMatchObject({
    version: 2,
    nutrition: { calories_kcal: 300, fat_g: null },
  });
});
it('correction prevents saving against an unloaded record', async () => {
  rejectRecordRead = true;
  const p = await editor('water', 'unknown');
  input(p, 'amount_ml', '600');
  await p.save();
  expect(p.data.error).toContain('原记录');
  expect(c.pending()).toHaveLength(0);
  expect(navigation).toHaveLength(0);
});
it('undo uses the original version and removes the record from daily totals', async () => {
  const r = await c.mutate('/records', { kind: 'water', amount_ml: 350 });
  const p = await editor('water', r.entity.id);
  await p.undo();
  expect((await c.request('GET', '/records')).items).toHaveLength(0);
  expect(
    (await c.request('GET', '/days/2026-10-11/summary')).water_ml.known_total,
  ).toBe(0);
});
it('stale corrections surface a conflict instead of overwriting another edit', async () => {
  const r = await c.mutate('/records', { kind: 'water', amount_ml: 350 });
  const p = await editor('water', r.entity.id);
  await c.mutate(
    '/records/' + r.entity.id,
    { expected_version: 1, patch: { amount_ml: 400 } },
    'PATCH',
  );
  input(p, 'amount_ml', '600');
  await p.save();
  expect(p.data.error).toContain('更新');
  expect((await c.request('GET', '/records/' + r.entity.id)).amount_ml).toBe(
    400,
  );
  expect(navigation).toHaveLength(0);
});
it('a lost save response replays the same input without creating duplicate records', async () => {
  const p = await editor('water');
  input(p, 'amount_ml', '350');
  loseNextMutation = true;
  await p.save();
  await p.save();
  expect((await c.request('GET', '/records')).items).toHaveLength(1);
  expect(c.pending()).toHaveLength(0);
  expect(navigation).toEqual([{ type: 'back' }]);
});
it('cannot reset a correction while its write awaits a receipt, then reloads the latest entity explicitly', async () => {
  const r = await c.mutate('/records', { kind: 'water', amount_ml: 350 });
  const p = await editor('water', r.entity.id);
  await c.mutate(
    '/records/' + r.entity.id,
    { expected_version: 1, patch: { amount_ml: 400 } },
    'PATCH',
  );
  input(p, 'amount_ml', '600');
  await p.save();
  await p.reloadEntity();
  expect(p.data.error).toContain('待处理');
  expect(p.data.form.amount_ml).toBe('600');
  c.discard(c.pending()[0].id);
  await p.reloadEntity();
  expect(p.data.entity.version).toBe(2);
  expect(p.data.form.amount_ml).toBe('400');
  input(p, 'amount_ml', '500');
  await p.save();
  expect(await c.request('GET', '/records/' + r.entity.id)).toMatchObject({
    amount_ml: 500,
    version: 3,
  });
});
it('retrying a pending save keeps a different edited form and its scoped draft', async () => {
  const p = await editor('food');
  input(p, 'name', '米饭');
  input(p, 'assumptions', '150g熟米饭');
  input(p, 'calories_kcal', '200');
  loseNextMutation = true;
  await p.save();
  const id = c.pending()[0].id;
  input(p, 'name', '鸡肉');
  await p.save();
  expect(p.data.error).toContain('等待确认');
  await p.retryInput({ detail: { id } });
  expect(p.data.form.name).toBe('鸡肉');
  expect(navigation).toHaveLength(0);
  const reopened = await editor('food');
  expect(reopened.data.form.name).toBe('鸡肉');
  expect((await c.request('GET', '/records')).items[0].name).toBe('米饭');
});
it('editor draft does not leak to a new credential connection', async () => {
  const p = await editor('water');
  input(p, 'amount_ml', '777');
  await c.connect({ base_url: 'https://other.test', token: 'test-token' });
  await p.load();
  expect(p.data.form.amount_ml).toBe('250');
  await c.connect({ base_url: 'https://fit.test', token: 'test-token' });
  await p.load();
  expect(p.data.form.amount_ml).toBe('777');
});
it('target creation shows a draft until its displayed version is confirmed', async () => {
  const p = await editor('target');
  input(p, 'water_ml', '2200');
  input(p, 'protein_g', '140');
  await p.save();
  expect(p.data.draft.status).toBe('draft');
  expect((await c.request('GET', '/days/2026-10-11/summary')).target_id).toBe(
    null,
  );
  expect(navigation).toHaveLength(0);
  await p.confirmTarget();
  expect(
    (await c.request('GET', '/days/2026-10-11/summary')).water_ml.target,
  ).toBe(2200);
  expect(navigation).toEqual([{ type: 'tab', url: '/pages/today/index' }]);
});
it('an existing target draft loads its unknown values and confirms directly', async () => {
  const t = await c.mutate('/targets/drafts', {
    effective_from: '2026-10-11',
    water_ml: 2000,
    calories_kcal: null,
    carbs_g: null,
    protein_g: 140,
    fat_g: null,
  });
  const p = await editor('target', t.id);
  expect(p.data.form.calories_kcal).toBe('');
  expect(p.data.draft.id).toBe(t.id);
  await p.confirmTarget();
  expect((await c.request('GET', '/targets'))[0].status).toBe('active');
});
it('memory correction and deletion change the facts returned to the coach', async () => {
  const m = await c.mutate('/memories', {
    key: 'training_time',
    value: '喜欢早上训练',
    source_message_id: 'msg-one',
  });
  const p = await editor('memory', m.id);
  input(p, 'value', '喜欢晚上训练');
  await p.save();
  expect((await c.request('GET', '/memories'))[0]).toMatchObject({
    value: '喜欢晚上训练',
    version: 2,
  });
  await import('../src/pages/profile/index');
  const profile = page();
  await profile.load();
  await profile.forget({ currentTarget: { dataset: { id: m.id } } });
  expect(await c.request('GET', '/memories')).toHaveLength(0);
});
it('secondary settings saves timezone and reminder with its current profile version', async () => {
  await import('../src/pages/settings/index');
  const p = page();
  await p.load();
  p.input({
    currentTarget: { dataset: { field: 'timezone' } },
    detail: { value: 'Asia/Tokyo' },
  });
  p.input({
    currentTarget: { dataset: { field: 'reminder_time' } },
    detail: { value: '20:30' },
  });
  p.toggleNotifications({ detail: { value: false } });
  await p.saveProfile();
  expect(await c.request('GET', '/profile')).toMatchObject({
    timezone: 'Asia/Tokyo',
    reminder_time: '20:30',
    notifications_enabled: false,
    version: 1,
  });
  p.input({
    currentTarget: { dataset: { field: 'reminder_time' } },
    detail: { value: '19:30' },
  });
  await p.saveProfile();
  expect((await c.request('GET', '/profile')).version).toBe(2);
});
it('a confirmed record save leaves the editor even when balance refresh is temporarily unavailable', async () => {
  const p = await editor('water');
  input(p, 'amount_ml', '350');
  c.refresh = async () => {
    throw new Error('暂时无法连接服务');
  };
  await p.save();
  expect((await c.request('GET', '/records')).items).toHaveLength(1);
  expect(c.pending()).toHaveLength(0);
  expect(navigation).toEqual([{ type: 'back' }]);
});
it('retrying an earlier correction keeps later edits and advances their base version', async () => {
  const r = await c.mutate('/records', { kind: 'water', amount_ml: 250 });
  const p = await editor('water', r.entity.id);
  input(p, 'amount_ml', '350');
  loseNextMutation = true;
  await p.save();
  const id = c.pending()[0].id;
  input(p, 'amount_ml', '500');
  await p.retryInput({ detail: { id } });
  expect(p.data.form.amount_ml).toBe('500');
  expect(p.data.entity.version).toBe(2);
  expect(navigation).toHaveLength(0);
  await p.save();
  expect(await c.request('GET', '/records/' + r.entity.id)).toMatchObject({
    amount_ml: 500,
    version: 3,
  });
});
it('retrying profile settings keeps later edits and lets them save against the new version', async () => {
  await import('../src/pages/settings/index');
  const p = page();
  await p.load();
  p.input({
    currentTarget: { dataset: { field: 'reminder_time' } },
    detail: { value: '20:00' },
  });
  loseNextMutation = true;
  await p.saveProfile();
  const id = c.pending()[0].id;
  p.input({
    currentTarget: { dataset: { field: 'reminder_time' } },
    detail: { value: '19:00' },
  });
  await p.retryInput({ detail: { id } });
  expect(p.data.reminder_time).toBe('19:00');
  await p.saveProfile();
  expect(await c.request('GET', '/profile')).toMatchObject({
    reminder_time: '19:00',
    version: 2,
  });
});
it('body editor saves the selected metric and prevents invalid body-fat percentages', async () => {
  const p = await editor('body');
  input(p, 'metric', 'body_fat_percent');
  input(p, 'value', '101');
  await p.save();
  expect(c.pending()).toHaveLength(0);
  expect((await c.request('GET', '/records')).items).toHaveLength(0);
  input(p, 'value', '21.5');
  await p.save();
  expect((await c.request('GET', '/records')).items[0]).toMatchObject({
    metric: 'body_fat_percent',
    value: 21.5,
  });
});
