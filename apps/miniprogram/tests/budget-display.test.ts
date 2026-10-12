import { expect, it } from 'vitest';
import { LocalClient } from '../src/local/client';
import { budgetView } from '../src/lib/view';
import { platformStore } from './local-fixtures';

it('keeps provisional nutrition allowances visible when a food is incomplete, then returns to complete amounts after correction', async () => {
  const c = new LocalClient(
    platformStore(),
    () => new Date('2026-10-11T10:00:00Z'),
  );
  await c.refresh();
  const target = await c.mutate('/targets/drafts', {
    effective_from: '2026-10-11',
    water_ml: 2500,
    calories_kcal: 2400,
    carbs_g: 250,
    protein_g: 150,
    fat_g: 70,
  });
  await c.mutate('/targets/' + target.id + '/confirm', {
    expected_version: target.version,
  });
  await c.mutate('/records', {
    kind: 'food',
    source: 'estimate',
    name: '已记录的一餐',
    nutrition: {
      calories_kcal: 1237,
      carbs_g: 127,
      protein_g: 79,
      fat_g: 33.5,
    },
  });
  const partial = await c.mutate('/records', {
    kind: 'food',
    source: 'estimate',
    name: '待补食品',
    nutrition: {
      calories_kcal: null,
      carbs_g: null,
      protein_g: null,
      fat_g: null,
    },
  });
  await c.refresh();
  for (const [key, allowance] of [
    ['calories_kcal', '1163'],
    ['carbs_g', '123'],
    ['protein_g', '71'],
    ['fat_g', '37'],
  ] as const) {
    expect(c.data.summary[key].remaining).toBeNull();
    expect(budgetView(key, c.data.summary[key])).toMatchObject({
      remaining: allowance,
      estimated: true,
      incomplete: true,
      status: '按已记录估算',
      note: '待补部分未计入',
    });
  }
  await c.mutate(
    '/records/' + partial.entity.id,
    {
      expected_version: partial.entity.version,
      patch: {
        nutrition: { calories_kcal: 100, carbs_g: 10, protein_g: 5, fat_g: 4 },
      },
    },
    'PATCH',
  );
  await c.refresh();
  expect(
    budgetView('calories_kcal', c.data.summary.calories_kcal),
  ).toMatchObject({
    remaining: '1063',
    incomplete: false,
    estimated: true,
    note: '含估算记录',
  });
});

it('shows provisional exceeded amounts without a negative remaining budget or losing the estimate marker', () => {
  const raw = {
    target: 2400,
    known_total: 2600,
    remaining: null,
    over: null,
    incomplete: true,
    estimated: false,
  };
  expect(budgetView('calories_kcal', raw)).toMatchObject({
    value: '200',
    remaining: '0',
    label: '已超出',
    over: true,
    estimated: true,
    percent: 100,
    status: '约超出 200kcal',
    note: '待补部分未计入',
  });
  expect(raw.remaining).toBeNull();
  expect(raw.over).toBeNull();
});

it('does not invent an unset target and preserves complete exact amounts', () => {
  expect(
    budgetView('protein_g', {
      target: null,
      known_total: 79,
      incomplete: true,
      remaining: null,
      over: null,
    }),
  ).toMatchObject({ remaining: '—', label: '待设目标', status: '未设目标' });
  expect(
    budgetView('water_ml', {
      target: 2500,
      known_total: 2000,
      remaining: 500,
      over: 0,
      incomplete: false,
      estimated: false,
    }),
  ).toMatchObject({
    remaining: '500',
    estimated: false,
    incomplete: false,
    status: '距今日目标',
  });
  expect(
    budgetView('fat_g', {
      target: 70,
      known_total: 0,
      remaining: null,
      over: null,
      incomplete: true,
      estimated: false,
    }),
  ).toMatchObject({ remaining: '70', estimated: true, note: '待补部分未计入' });
});
