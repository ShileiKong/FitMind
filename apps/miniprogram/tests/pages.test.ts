import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../../api/src/app';
import { MiniClient } from '../src/lib/client';
let app: any,
  db: DatabaseSync,
  c: MiniClient,
  definition: any,
  loseNext: boolean;
const ex = {
  exercise_id: 'bench',
  name: '卧推',
  variant: '',
  equipment: 'barbell',
  load_convention: 'total',
  weight_kg: 30,
  increment_kg: 2.5,
  sets: 3,
  reps_min: 8,
  reps_max: 12,
  rest_seconds: 90,
};
beforeEach(async () => {
  loseNext = false;
  vi.resetModules();
  db = new DatabaseSync(':memory:');
  app = await createApp({
    db,
    clock: () => new Date('2026-10-11T10:00:00Z'),
    access_token: 'test-token',
    media_root: 'data/test-media',
  });
  const store = new Map();
  const bridge = {
    getStorageSync: (k: string) => structuredClone(store.get(k)),
    setStorageSync: (k: string, v: any) => store.set(k, structuredClone(v)),
    removeStorageSync: (k: string) => store.delete(k),
    request: (o: any) => {
      void app
        .inject({
          method: o.method,
          url: new URL(o.url).pathname + new URL(o.url).search,
          headers: o.header,
          payload: o.data,
        })
        .then((r: any) => {
          if (loseNext && o.method === 'POST') {
            loseNext = false;
            o.fail({});
          } else o.success({ statusCode: r.statusCode, data: r.json() });
        });
    },
    uploadFile: () => {},
  };
  c = new MiniClient(bridge);
  await c.connect({ base_url: 'https://fit.test', token: 'test-token' });
  vi.stubGlobal('getApp', () => ({ client: c }));
  vi.stubGlobal('getCurrentPages', () => [{ route: 'pages/settings/index' }]);
  vi.stubGlobal('Page', (p: any) => {
    definition = p;
  });
  vi.stubGlobal('wx', {
    showToast: () => {},
    showModal: (o: any) => o.success({ confirm: true }),
    switchTab: () => {},
    navigateTo: () => {},
  });
});
afterEach(async () => {
  await app.close();
  db.close();
  vi.unstubAllGlobals();
});
function page() {
  const p = {
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
  return p;
}
it('repeated label Save after a lost response replays the original record', async () => {
  await import('../src/pages/food/index');
  const p = page();
  await p.load();
  p.data.form = {
    name: '牛奶',
    basis: '100',
    consumed: '250',
    unit: 'ml',
    calories: '46',
    carbs: '4',
    protein: '3',
    fat: '',
  };
  loseNext = true;
  await p.save();
  expect(c.pending()).toHaveLength(1);
  await p.save();
  const result = await c.request('GET', '/records');
  expect(result.items).toHaveLength(1);
  expect(c.pending()).toHaveLength(0);
  expect(p.data.form.name).toBe('');
});
it('retrying a pending label record preserves a different edited unsaved form', async () => {
  await import('../src/pages/food/index');
  const p = page();
  await p.load();
  p.data.form = {
    name: '牛奶',
    basis: '100',
    consumed: '250',
    unit: 'ml',
    calories: '46',
    carbs: '4',
    protein: '3',
    fat: '',
  };
  loseNext = true;
  await p.save();
  const id = c.pending()[0].id;
  p.data.form.name = '酸奶';
  await p.save();
  expect(p.data.error).toContain('等待确认');
  await p.retryInput({ detail: { id } });
  expect(p.data.form.name).toBe('酸奶');
  expect(p.data.form.consumed).toBe('250');
  const result = await c.request('GET', '/records');
  expect(result.items).toHaveLength(1);
  expect(result.items[0].name).toBe('牛奶');
});
it('clears a cached balance before beginning a new connection refresh', async () => {
  await c.mutate('/records', { kind: 'water', amount_ml: 500 });
  await import('../src/pages/today/index');
  const p = page();
  await p.load();
  expect(p.data.budgets[0].total).toBe('500');
  await c.connect({ base_url: 'https://other.test', token: 'test-token' });
  let finish: () => void = () => {};
  const original = c.refresh.bind(c);
  c.refresh = () =>
    new Promise<void>((resolve) => {
      finish = async () => {
        await original();
        resolve();
      };
    });
  const loading = p.load();
  await Promise.resolve();
  await Promise.resolve();
  expect(p.data.budgets[0].total).toBe('—');
  finish();
  await loading;
});
it('water page records and undoes a real API record and refreshes the balance', async () => {
  await import('../src/pages/today/index');
  const p = page();
  await p.load();
  await p.addWater({ currentTarget: { dataset: { amount: 250 } } });
  expect(p.data.records).toHaveLength(1);
  expect(p.data.budgets[0].total).toBe('250');
  await p.undoRecord({
    currentTarget: { dataset: { id: p.data.records[0].id } },
  });
  expect(p.data.records).toHaveLength(0);
  expect(p.data.budgets[0].total).toBe('0');
});
it('opens chat and connection settings as secondary pages, preserving four-tab navigation', async () => {
  const navigation = vi.fn();
  wx.navigateTo = navigation;
  await import('../src/pages/today/index');
  const p = page();
  p.openSettings();
  expect(navigation).toHaveBeenLastCalledWith({ url: '/pages/settings/index' });
  p.openChat({ currentTarget: { dataset: { prompt: '喝了300毫升水' } } });
  expect(navigation).toHaveBeenLastCalledWith({ url: '/pages/chat/index' });
  expect(c.saved('draft', '')).toBe('喝了300毫升水');
});
it('home record correction opens the selected record in the editor', async () => {
  const r = await c.mutate('/records', { kind: 'water', amount_ml: 300 });
  const navigation = vi.fn();
  wx.navigateTo = navigation;
  await import('../src/pages/today/index');
  const p = page();
  await p.load();
  p.editRecord({ currentTarget: { dataset: { id: r.entity.id } } });
  expect(navigation).toHaveBeenCalledWith({
    url: '/pages/editor/index?mode=water&id=' + r.entity.id,
  });
});
it('persistent tab composer shares its draft with the conversation page', async () => {
  let component: any;
  vi.stubGlobal('Component', (p: any) => {
    component = p;
  });
  await import('../src/custom-tab-bar/index');
  const p: any = {
    ...component.methods,
    data: structuredClone(component.data),
    setData(values: any) {
      Object.assign(this.data, values);
    },
  };
  p.input({ detail: { value: '刚喝了300毫升水' } });
  expect(c.saved('draft', '')).toBe('刚喝了300毫升水');
  const navigate = vi.fn();
  wx.navigateTo = navigate;
  p.openChat();
  expect(navigate).toHaveBeenCalledWith({ url: '/pages/chat/index' });
  expect(p.data.draft).toBe('刚喝了300毫升水');
});
it('goal confirmation activates the displayed draft using its exact version', async () => {
  const t = await c.mutate('/targets/drafts', {
    effective_from: '2026-10-11',
    water_ml: 2000,
    calories_kcal: 2000,
    carbs_g: 200,
    protein_g: 140,
    fat_g: 60,
  });
  await import('../src/pages/settings/index');
  const p = page();
  await p.load();
  await p.confirmTarget({ currentTarget: { dataset: { id: t.id } } });
  expect(p.data.targets[0].status).toBe('active');
  expect(c.data.summary.water_ml.remaining).toBe(2000);
});
it('next-set suggestions fill the current exercise without calling the future-plan API', async () => {
  const d = await c.mutate('/plans/drafts', {
    name: '今日上肢',
    days: [{ local_date: '2026-10-11', name: '推', exercises: [ex] }],
  });
  const active = await c.mutate('/plans/' + d.id + '/confirm', {
    expected_version: d.version,
  });
  await c.mutate('/workout-sessions', { workout_day_id: active.days[0].id });
  await import('../src/pages/workout/index');
  const p = page();
  await p.load();
  p.data.weight = '30';
  p.data.reps = '12';
  p.data.difficulty = 'easy';
  await p.recordSet();
  expect(p.data.sets).toHaveLength(1);
  const r = p.data.recommendations.find((r: any) => r.status === 'proposed');
  expect(r.weight_kg).toBe(32.5);
  await p.accept({ currentTarget: { dataset: { id: r.id } } });
  expect(p.data.weight).toBe('32.5');
  expect(p.data.error).toBe('');
  expect(c.pending()).toHaveLength(0);
});
it('clears yesterday balances when today refresh fails', async () => {
  await c.mutate('/records', { kind: 'water', amount_ml: 500 });
  await import('../src/pages/today/index');
  const p = page();
  await p.load();
  expect(p.data.budgets[0].total).toBe('500');
  c.disconnect();
  await p.load();
  expect(p.data.budgets[0].value).toBe('—');
  expect(p.data.records).toHaveLength(0);
});
