import { expect, it } from 'vitest';
import {
  nutrientBreakdown,
  nutrientSelection,
  fetchNutrientBreakdown,
} from '../src/lib/nutrition-breakdown';
import { LocalClient } from '../src/local/client';
import { platformStore } from './local-fixtures';

const date = '2026-10-11';
const food = (id: string, values: any = {}) => ({
  id,
  kind: 'food',
  local_date: date,
  name: id,
  source: 'estimate',
  nutrition: { calories_kcal: 100, carbs_g: 10, protein_g: 5, fat_g: 3 },
  undone_at: null,
  ...values,
});

it('keeps unknown values separate from real zero and computes shares from known food amounts', () => {
  const records = [
    food('label', {
      name: '酸奶',
      source: 'label',
      nutrition: { calories_kcal: 150 },
      label: { consumed_quantity: 150, consumed_unit: 'g' },
    }),
    food('estimate', {
      name: '米饭',
      nutrition: { calories_kcal: 50 },
      assumptions: '熟米饭约半碗',
    }),
    food('unknown', { nutrition: { calories_kcal: null } }),
    food('zero', { source: 'label', nutrition: { calories_kcal: 0 } }),
    food('missing', { nutrition: {} }),
  ];
  const original = structuredClone(records);
  const view = nutrientBreakdown(records, date, 'calories_kcal', {
    calories_kcal: { target: 500, known_total: 999, remaining: 1 },
  });
  expect(view.knownTotal).toBe(200);
  expect(view.unknownCount).toBe(2);
  expect(view.budget.total).toBe('200');
  expect(view.budget.value).toBe('300');
  expect(view.budget.incomplete).toBe(true);
  expect(view.rows[0]).toMatchObject({
    name: '酸奶',
    amountText: '150',
    shareText: '75%',
    sourceLabel: '营养标签',
    quantityText: '实际食用 150 g',
    editUrl: '/pages/editor/index?mode=food&id=label',
  });
  expect(view.rows[1]).toMatchObject({
    amountText: '约 50',
    shareText: '25%',
    sourceLabel: '估算',
    assumptionsText: '熟米饭约半碗',
  });
  expect(view.rows[2]).toMatchObject({
    amountText: '待补',
    shareText: '待补',
    known: false,
  });
  expect(view.rows[3]).toMatchObject({
    amountText: '0',
    shareText: '0%',
    known: true,
  });
  expect(view.rows[4].known).toBe(false);
  expect(records).toEqual(original);
});

it('excludes undone, other-day, water and body records from food contributions', () => {
  const view = nutrientBreakdown(
    [
      food('correct', { nutrition: { protein_g: 10 } }),
      food('undone', { undone_at: '2026-10-11T11:00:00Z' }),
      food('yesterday', { local_date: '2026-10-10' }),
      { id: 'water', kind: 'water', local_date: date, amount_ml: 500 },
      {
        id: 'body',
        kind: 'body',
        local_date: date,
        metric: 'weight_kg',
        value: 70,
      },
    ],
    date,
    'protein_g',
    {},
  );
  expect(view.rows.map((row) => row.id)).toEqual(['correct']);
  expect(view.knownTotal).toBe(10);
  expect(view.budget.target).toBe('—');
});

it('provides separate water amounts, notes and encoded links', () => {
  const view = nutrientBreakdown(
    [
      food('food'),
      {
        id: 'water /?&',
        kind: 'water',
        local_date: date,
        amount_ml: 250,
        note: '运动后',
      },
      { id: 'water2', kind: 'water', local_date: date, amount_ml: 750 },
    ],
    date,
    'water_ml',
    { water_ml: { target: 2000 } },
  );
  expect(view.knownTotal).toBe(1000);
  expect(view.rows[0]).toMatchObject({
    kind: 'water',
    name: '饮水记录',
    amountText: '250',
    shareText: '25%',
    note: '运动后',
    editUrl: '/pages/editor/index?mode=water&id=water%20%2F%3F%26',
  });
  expect(view.budget.value).toBe('1000');
  expect(view.budget.estimated).toBe(false);
});

it('handles an all-zero known total without producing an unknown or invalid percentage', () => {
  const view = nutrientBreakdown(
    [food('zero', { nutrition: { fat_g: 0 } })],
    date,
    'fat_g',
    {},
  );
  expect(view.rows[0]).toMatchObject({
    amountText: '约 0',
    shareText: '0%',
    sharePercent: 0,
  });
  expect(view.knownTotal).toBe(0);
  expect(view.unknownCount).toBe(0);
});

it('validates the nutrient and natural date and only defaults an absent date', () => {
  expect(
    nutrientSelection({ key: 'carbs_g', date: '2026-10-09' }, date),
  ).toEqual({ key: 'carbs_g', date: '2026-10-09' });
  expect(nutrientSelection({ key: 'water_ml' }, date)).toEqual({
    key: 'water_ml',
    date,
  });
  for (const invalidDate of ['', '2026-02-30', '2026-13-01', '26-10-11'])
    expect(() =>
      nutrientSelection({ key: 'fat_g', date: invalidDate }, date),
    ).toThrow('日期');
  expect(() => nutrientSelection({ key: 'body', date }, date)).toThrow('营养');
});

it('fetches more than 100 historical records using the server cursor without changing the dashboard cache', async () => {
  const c = new LocalClient(
    platformStore(),
    () => new Date('2026-10-11T10:00:00Z'),
  );
  for (let i = 0; i < 105; i++)
    await c.core.request(
      'POST',
      '/records',
      {
        kind: 'food',
        name: '食物 ' + i,
        source: 'estimate',
        local_date: '2026-10-09',
        nutrition: { calories_kcal: 10, carbs_g: 1, protein_g: 0, fat_g: null },
      },
      'create-' + i,
    );
  await c.core.request(
    'POST',
    '/records',
    {
      kind: 'water',
      amount_ml: 200,
      local_date: '2026-10-09',
    },
    'water',
  );
  await c.refresh();
  const cached = structuredClone(c.data.records);
  const view = await fetchNutrientBreakdown(c, '2026-10-09', 'calories_kcal');
  expect(view?.date).toBe('2026-10-09');
  expect(view?.rows).toHaveLength(105);
  expect(view?.knownTotal).toBe(1050);
  expect(c.data.records).toEqual(cached);
});

it('discards a result invalidated while a page request is in flight', async () => {
  let active = true;
  const c = new LocalClient(
    platformStore(),
    () => new Date('2026-10-11T10:00:00Z'),
  );
  await c.mutate('/records', { kind: 'water', amount_ml: 200 });
  const original = c.request.bind(c);
  c.request = async (...args) => {
    const result = await original(...args);
    active = false;
    return result;
  };
  expect(
    await fetchNutrientBreakdown(c, date, 'water_ml', () => active),
  ).toBeNull();
});
