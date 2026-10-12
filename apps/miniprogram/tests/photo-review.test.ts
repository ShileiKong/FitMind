import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocalClient } from '../src/local/client';

let c: LocalClient, app: any, definition: any, now: Date;
let analysis: any, analyzeCalls: any[], recordCalls: any[];
const clone = structuredClone;
const asset = {
  id: 'photo-test',
  kind: 'image',
  mime_type: 'image/jpeg',
  size_bytes: 300,
  created_at: '2026-10-12T15:59:00Z',
  local_date: '2026-10-12',
  version: 1,
  preview_path: 'wxfile://meal.jpg',
};
const meal = () => ({
  type: 'estimated_food',
  name: '鸡肉饭',
  nutrition: { calories_kcal: 500, carbs_g: 60, protein_g: 30, fat_g: null },
  basis_quantity: null,
  basis_unit: null,
  portion_description: '一整份，约400克',
  assumptions: '米饭与鸡肉按常见份量估算',
  question: null,
});
beforeEach(async () => {
  vi.resetModules();
  const storage = new Map<string, any>();
  now = new Date('2026-10-12T15:59:00Z');
  c = new LocalClient(
    {
      getStorageSync: (key: string) => clone(storage.get(key)),
      setStorageSync: (key: string, value: any) =>
        storage.set(key, clone(value)),
      removeStorageSync: (key: string) => storage.delete(key),
    },
    () => now,
  );
  await c.refresh();
  c.core.store.put('personal', 'media', asset);
  analysis = meal();
  analyzeCalls = [];
  recordCalls = [];
  const request = c.request.bind(c);
  c.request = async (method, path, body, key) => {
    if (method === 'GET' && path === '/media/photo-test') return clone(asset);
    if (method === 'POST' && path === '/nutrition/analyze') {
      analyzeCalls.push({ body, key });
      if (analysis instanceof Error) throw analysis;
      return clone(analysis);
    }
    if (method === 'POST' && path === '/records')
      recordCalls.push({ body: clone(body), key });
    return request(method, path, body, key);
  };
  app = { client: c };
  vi.stubGlobal('getApp', () => app);
  vi.stubGlobal('Page', (d: any) => {
    definition = d;
  });
  vi.stubGlobal('wx', {
    showToast: vi.fn(),
    navigateBack: vi.fn(),
    stopPullDownRefresh: vi.fn(),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function page(mode = 'meal', show = true) {
  await import('../src/pages/photo-review/index');
  const p: any = {
    ...definition,
    data: structuredClone(definition.data),
    setData(values: any) {
      for (const [key, value] of Object.entries(values)) {
        const path = key.split('.');
        let target = this.data;
        for (const part of path.slice(0, -1))
          target = target[part] ?? (target[part] = {});
        target[path.at(-1)!] = value;
      }
    },
  };
  p.onLoad({ asset: asset.id, mode });
  if (show) await p.onShow();
  return p;
}
const input = (p: any, field: string, value: string) =>
  p.input({ currentTarget: { dataset: { field } }, detail: { value } });

it('analyzes a meal without writing food, then confirms exactly one real estimate with a visible record id', async () => {
  const p = await page();
  expect(analyzeCalls).toHaveLength(1);
  expect((await c.request('GET', '/records')).items).toHaveLength(0);
  expect(p.data.form.fat).toBe('');
  await p.confirm();
  await p.confirm();
  const records = (await c.request('GET', '/records')).items;
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    name: '鸡肉饭',
    source: 'estimate',
    local_date: '2026-10-12',
    attachment_ids: [asset.id],
    nutrition: { calories_kcal: 500, fat_g: null },
  });
  expect(records[0].assumptions).toContain('一整份，约400克');
  expect(p.data.recordId).toBe(records[0].id);
  expect(recordCalls).toHaveLength(1);
});
it('requires real label consumption and computes same-unit ratios, preserving unknown nutrients', async () => {
  analysis = {
    ...meal(),
    type: 'label_draft',
    name: '牛奶',
    basis_quantity: 100,
    basis_unit: 'ml',
    nutrition: { calories_kcal: 46, carbs_g: 4, protein_g: 3, fat_g: null },
  };
  const p = await page('label');
  expect(p.data.form.consumed).toBe('');
  await p.confirm();
  expect(recordCalls).toHaveLength(0);
  input(p, 'consumed', '250');
  await p.confirm();
  const r = (await c.request('GET', '/records')).items[0];
  expect(r.nutrition).toEqual({
    calories_kcal: 115,
    carbs_g: 10,
    protein_g: 7.5,
    fat_g: null,
  });
  expect(r.label).toMatchObject({
    basis_quantity: 100,
    basis_unit: 'ml',
    consumed_quantity: 250,
    consumed_unit: 'ml',
  });
});
it('preserves edited fields and the capture date through refresh and midnight', async () => {
  const p = await page();
  input(p, 'name', '我修改的鸡肉饭');
  now = new Date('2026-10-12T16:01:00Z');
  await c.refresh();
  await p.load();
  expect(p.data.date).toBe('2026-10-12');
  expect(p.data.form.name).toBe('我修改的鸡肉饭');
  expect(analyzeCalls).toHaveLength(1);
  await p.confirm();
  expect(recordCalls[0].body.local_date).toBe('2026-10-12');
});
it('requires another estimate or explicitly edited totals when the meal portion changes', async () => {
  const p = await page();
  input(p, 'portion', '只吃了一半');
  await p.confirm();
  expect(recordCalls).toHaveLength(0);
  input(p, 'calories', '250');
  input(p, 'carbs', '30');
  input(p, 'protein', '15');
  p.manualTotals({ detail: { value: ['checked'] } });
  await p.confirm();
  expect(recordCalls[0].body.nutrition.calories_kcal).toBe(250);
  expect(recordCalls[0].body.assumptions).toContain('只吃了一半');
});
it('keeps needs_input separate from a successful draft and allows added description to identify again', async () => {
  analysis = { ...meal(), type: 'needs_input', question: '请补充食用份量' };
  const p = await page();
  expect(p.data.ready).toBe(false);
  await p.confirm();
  expect(recordCalls).toHaveLength(0);
  p.description({ detail: { value: '鸡肉饭一份约400克' } });
  analysis = meal();
  await p.analyze();
  expect(analyzeCalls.at(-1).body.description).toBe('鸡肉饭一份约400克');
  expect(p.data.ready).toBe(true);
});
it.each(['NaN', '-1', 'Infinity'])(
  'does not save invalid nutrition %s',
  async (value) => {
    const p = await page();
    input(p, 'calories', value);
    await p.confirm();
    expect(recordCalls).toHaveLength(0);
    expect(p.data.error).not.toBe('');
  },
);
it('retains a truncated analysis error without presenting a confirmable draft', async () => {
  analysis = new Error('图片回复被截断，请重新识别');
  const p = await page();
  expect(p.data.ready).toBe(false);
  expect(p.data.error).toContain('截断');
  await p.confirm();
  expect(recordCalls).toHaveLength(0);
});
it('retries the original fixed body and outbox key after a lost response without a duplicate record', async () => {
  const p = await page();
  const request = c.request.bind(c);
  let lost = true;
  c.request = async (method, path, body, key) => {
    const result = await request(method, path, body, key);
    if (path === '/records' && method === 'POST' && lost) {
      lost = false;
      throw new Error('回执连接中断');
    }
    return result;
  };
  await p.confirm();
  expect(c.pending()).toHaveLength(1);
  input(p, 'name', '重试期间的新名称');
  await p.confirm();
  const records = (await c.request('GET', '/records')).items;
  expect(records).toHaveLength(1);
  expect(records[0].name).toBe('鸡肉饭');
  expect(recordCalls[1]).toEqual(recordCalls[0]);
  expect(p.data.recordId).toBe(records[0].id);
});

it('confirms on the native runtime without browser-only structuredClone', async () => {
  const p = await page();
  vi.stubGlobal('structuredClone', undefined);
  await p.confirm();
  expect((await c.request('GET', '/records')).items).toHaveLength(1);
  expect(p.data.recordId).not.toBe('');
});

it('rejects label quantities in different units instead of guessing density', async () => {
  analysis = {
    ...meal(),
    type: 'label_draft',
    basis_quantity: 100,
    basis_unit: 'ml',
  };
  const p = await page('label');
  input(p, 'consumed', '250');
  p.unit({
    currentTarget: { dataset: { field: 'consumed_unit' } },
    detail: { value: '1' },
  });
  await p.confirm();
  expect(recordCalls).toHaveLength(0);
  expect(p.data.error).toContain('相同的单位');
});

it('does not paint a late analysis after the review page was hidden', async () => {
  const request = c.request.bind(c);
  let finish!: () => void;
  c.request = (method, path, body, key) =>
    path === '/nutrition/analyze'
      ? new Promise((resolve) => {
          finish = () => void request(method, path, body, key).then(resolve);
        })
      : request(method, path, body, key);
  const p = await page('meal', false);
  const opening = p.onShow();
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  p.onHide();
  finish();
  await opening;
  expect(p.data.ready).toBe(false);
  expect(p.data.form.name).toBe('');
  expect(recordCalls).toHaveLength(0);
});

it('clears the old review and blocks confirmation after a client replacement', async () => {
  const p = await page();
  app.client = { storageKey: 'new-scope' };
  await p.onShow();
  expect(p.data.form.name).toBe('');
  expect(p.data.previewPath).toBe('');
  await p.confirm();
  expect(recordCalls).toHaveLength(0);
});

it('rejects a label ratio that overflows instead of silently recording unknown nutrition', async () => {
  analysis = {
    ...meal(),
    type: 'label_draft',
    basis_quantity: 100,
    basis_unit: 'ml',
    nutrition: {
      calories_kcal: 1e308,
      carbs_g: null,
      protein_g: null,
      fat_g: null,
    },
  };
  const p = await page('label');
  input(p, 'basis', '0.001');
  input(p, 'consumed', '20000');
  await p.confirm();
  expect(recordCalls).toHaveLength(0);
  expect(p.data.error).not.toBe('');
});

it('keeps an excessive meal total editable without queueing it, then accepts corrected nutrition', async () => {
  const p = await page();
  input(p, 'calories', '100001');
  await p.confirm();
  expect(c.pending()).toHaveLength(0);
  expect(recordCalls).toHaveLength(0);
  expect(p.data.retryPending).toBe(false);
  expect(p.data.error).not.toBe('');
  input(p, 'calories', '550');
  await p.confirm();
  const records = (await c.request('GET', '/records')).items;
  expect(records).toHaveLength(1);
  expect(records[0].nutrition.calories_kcal).toBe(550);
  expect(p.data.recordId).toBe(records[0].id);
});

it.each(['per-basis', 'whole-portion'])(
  'keeps excessive label %s nutrition out of the queue and allows corrected confirmation',
  async (excess) => {
    analysis = {
      ...meal(),
      type: 'label_draft',
      basis_quantity: 100,
      basis_unit: 'ml',
      nutrition: { calories_kcal: 46, carbs_g: 4, protein_g: 3, fat_g: null },
    };
    const p = await page('label');
    input(p, 'consumed', '250');
    input(
      p,
      excess === 'per-basis' ? 'calories' : 'basis',
      excess === 'per-basis' ? '100001' : '0.1',
    );
    await p.confirm();
    expect(c.pending()).toHaveLength(0);
    expect(recordCalls).toHaveLength(0);
    expect(p.data.retryPending).toBe(false);
    expect(p.data.error).not.toBe('');
    input(p, 'calories', '46');
    input(p, 'basis', '100');
    await p.confirm();
    const records = (await c.request('GET', '/records')).items;
    expect(records).toHaveLength(1);
    expect(records[0].nutrition.calories_kcal).toBe(115);
    expect(records[0].nutrition.fat_g).toBeNull();
    expect(p.data.recordId).toBe(records[0].id);
  },
);

it('shows the pending receipt error when a save finishes after hiding and reopening the review', async () => {
  const p = await page();
  const request = c.request.bind(c);
  let finish!: () => void;
  c.request = (method, path, body, key) =>
    path === '/records' && method === 'POST'
      ? new Promise((resolve, reject) => {
          finish = () =>
            void request(method, path, body, key).then(
              () => reject(new Error('回执连接中断')),
              reject,
            );
        })
      : request(method, path, body, key);
  const saving = p.confirm();
  expect(finish).toBeTypeOf('function');
  p.onHide();
  await p.onShow();
  finish();
  await saving;
  await vi.waitFor(() => expect(p.data.busy).toBe(false));
  expect(p.data.retryPending).toBe(true);
  expect(p.data.error).toContain('回执连接中断');
  expect((await c.request('GET', '/records')).items).toHaveLength(1);
});

it('can reopen while an old media lookup is still pending without accepting its stale result', async () => {
  const request = c.request.bind(c);
  let finish!: () => void,
    first = true;
  c.request = (method, path, body, key) => {
    if (path === '/media/photo-test' && first) {
      first = false;
      return new Promise((resolve) => {
        finish = () => void request(method, path, body, key).then(resolve);
      });
    }
    return request(method, path, body, key);
  };
  const p = await page('meal', false);
  const opening = p.onShow();
  expect(finish).toBeTypeOf('function');
  p.onHide();
  await p.onShow();
  expect(p.data.ready).toBe(true);
  input(p, 'name', '返回后的核对名称');
  finish();
  await opening;
  expect(p.data.form.name).toBe('返回后的核对名称');
  expect(analyzeCalls).toHaveLength(1);
});
