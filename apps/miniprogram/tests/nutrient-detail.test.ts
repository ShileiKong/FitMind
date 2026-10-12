import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocalClient } from '../src/local/client';
import { Appearance } from '../src/lib/appearance';
import { platformStore } from './local-fixtures';

let definition: any,
  c: LocalClient,
  appearance: Appearance,
  navigation: string[];
let now: string;
beforeEach(() => {
  vi.resetModules();
  now = '2026-10-11T15:55:00Z';
  const platform = platformStore();
  c = new LocalClient(platform, () => new Date(now));
  appearance = new Appearance(platform);
  navigation = [];
  vi.stubGlobal('getApp', () => ({ client: c, appearance }));
  vi.stubGlobal('Page', (value: any) => {
    definition = value;
  });
  vi.stubGlobal('wx', {
    navigateTo: (value: any) => navigation.push(value.url),
    setNavigationBarColor: () => {},
    setBackgroundColor: () => {},
  });
});
afterEach(() => vi.unstubAllGlobals());

async function page(options: any) {
  await import('../src/pages/nutrient-detail/index');
  const p = {
    ...definition,
    data: structuredClone(definition.data),
    _visible: true,
    setData(value: any) {
      Object.assign(this.data, value);
    },
  };
  p.onLoad(options);
  await p.load();
  return p;
}
const recordFood = (name: string, local_date = '2026-10-11', amount = 100) =>
  c.mutate('/records', {
    kind: 'food',
    name,
    source: 'estimate',
    local_date,
    nutrition: { calories_kcal: amount, carbs_g: null, protein_g: 0, fat_g: 0 },
  });

function holdRecordRead(client: LocalClient) {
  const request = client.request.bind(client);
  let release!: () => void, arrived!: () => void;
  const waiting = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  client.request = async (method, path, ...args) => {
    const result = await request(method, path, ...args);
    if (!held && path.includes('/records?') && path.includes('&kind=')) {
      held = true;
      arrived();
      await gate;
    }
    return result;
  };
  return { waiting, release };
}

it('queries the selected historical day, excludes today and offers real record correction', async () => {
  const saved = await recordFood('昨天的米饭', '2026-10-10', 200);
  await recordFood('今天的鸡蛋');
  const p = await page({ key: 'calories_kcal', date: '2026-10-10' });
  expect(p.data.date).toBe('2026-10-10');
  expect(p.data.rows.map((row: any) => row.name)).toEqual(['昨天的米饭']);
  expect(p.data.budget.total).toBe('200');
  expect(p.data.canAdd).toBe(false);
  p.editRecord({ currentTarget: { dataset: { id: saved.entity.id } } });
  expect(navigation).toEqual([
    '/pages/editor/index?mode=food&id=' + saved.entity.id,
  ]);
});

it('defaults an absent date once and preserves that day across midnight refreshes', async () => {
  await recordFood('午夜前');
  const p = await page({ key: 'protein_g' });
  expect(p.data.date).toBe('2026-10-11');
  expect(p.data.canAdd).toBe(true);
  now = '2026-10-11T16:05:00Z';
  await recordFood('午夜后', '2026-10-12');
  await p.load();
  expect(p.data.date).toBe('2026-10-11');
  expect(p.data.rows.map((row: any) => row.name)).toEqual(['午夜前']);
  expect(p.data.canAdd).toBe(false);
});

it('shows an empty day, supports current-day water entry and applies both appearance choices', async () => {
  const p = await page({ key: 'water_ml', date: '2026-10-11' });
  expect(p.data.loaded).toBe(true);
  expect(p.data.rows).toEqual([]);
  expect(p.data.name).toBe('饮水');
  expect(p.data.budget.total).toBe('0');
  p.addRecord();
  expect(navigation).toEqual(['/pages/editor/index?mode=water']);
  expect(p.data.skin).toBe('midnight');
  appearance.select('deepseek');
  expect(p.data.skin).toBe('deepseek');
  expect(p.data.skinAccentIcon).toBe('blue');
});

it('rejects invalid query dates or keys without displaying a different day', async () => {
  await recordFood('今天');
  const p = await page({ key: 'carbs_g', date: '2026-02-30' });
  expect(p.data.detailError).toContain('日期');
  expect(p.data.rows).toEqual([]);
  expect(p.data.canAdd).toBe(false);
  const invalid = await page({ key: 'body', date: '2026-10-11' });
  expect(invalid.data.detailError).toContain('营养');
  expect(invalid.data.rows).toEqual([]);
});

it('discards older async contributions after another client becomes current', async () => {
  await recordFood('旧账号');
  const p = await page({ key: 'calories_kcal', date: '2026-10-11' });
  const old = c,
    hold = holdRecordRead(old);
  const pending = p.render(old);
  await hold.waiting;
  c = new LocalClient(platformStore(), () => new Date(now));
  await recordFood('新账号', '2026-10-11', 300);
  await p.load();
  hold.release();
  await pending;
  expect(p.data.rows.map((row: any) => row.name)).toEqual(['新账号']);
  expect(p.data.budget.total).toBe('300');
});

it.each(['clear', 'import'])(
  'discards an async projection after local %s replaces its scope',
  async (mode) => {
    await recordFood('旧记录');
    const backup = c.exportBackup();
    const p = await page({ key: 'calories_kcal', date: '2026-10-11' });
    const hold = holdRecordRead(c);
    const pending = p.render(c);
    await hold.waiting;
    if (mode === 'clear') await c.clearLocalData();
    else {
      const value = JSON.parse(backup);
      value.entities.find((entry: any) => entry.kind === 'record').value.name =
        '导入记录';
      await c.importBackup(JSON.stringify(value));
    }
    await p.load();
    hold.release();
    await pending;
    expect(p.data.rows.map((row: any) => row.name)).toEqual(
      mode === 'clear' ? [] : ['导入记录'],
    );
  },
);

it('discards a hidden page request even if the same page becomes visible again before it resolves', async () => {
  await recordFood('旧记录');
  const p = await page({ key: 'calories_kcal', date: '2026-10-11' });
  const hold = holdRecordRead(c);
  const pending = p.render(c);
  await hold.waiting;
  p.onHide();
  p._visible = true;
  await recordFood('新记录', '2026-10-11', 300);
  await p.render(c);
  hold.release();
  await pending;
  expect(p.data.rows).toHaveLength(2);
  expect(p.data.budget.total).toBe('400');
});

it('keeps a source read failure distinct from an empty day and recovers on retry', async () => {
  await recordFood('有记录');
  const p = await page({ key: 'calories_kcal', date: '2026-10-11' });
  const request = c.request.bind(c);
  c.request = async (method, path, ...args) => {
    if (path.includes('&kind=')) throw new Error('来源暂不可用');
    return request(method, path, ...args);
  };
  await p.render(c);
  expect(p.data.detailError).toBe('来源暂不可用');
  expect(p.data.loaded).toBe(false);
  c.request = request;
  await p.render(c);
  expect(p.data.detailError).toBe('');
  expect(p.data.rows[0].name).toBe('有记录');
});
