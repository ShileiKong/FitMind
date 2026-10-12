import { it, expect, afterEach } from 'vitest';
import { makeHarness } from './helpers.js';
import { calculateLabel } from '../src/modules/nutrition/calculate.js';
let h: any;
afterEach(async () => {
  if (h) await h.close();
  h = null;
});
const n = { calories_kcal: 200, carbs_g: 20, protein_g: null, fat_g: 5 };
const label = {
  basis_quantity: 100,
  basis_unit: 'g',
  consumed_quantity: 150,
  consumed_unit: 'g',
  nutrition_per_basis: n,
};
const food = {
  kind: 'food',
  name: '午餐',
  source: 'estimate',
  nutrition: n,
  assumptions: '约一份',
};
async function setup() {
  h = await makeHarness();
  return h;
}
async function target(date = '2026-10-11', calories = 2000) {
  const d = await h.services.targets.draft(
    { ...h.ctx, idempotency_key: 'draft' + date + calories },
    {
      effective_from: date,
      allow_history: true,
      water_ml: 2000,
      calories_kcal: calories,
      carbs_g: 250,
      protein_g: 120,
      fat_g: 60,
    },
  );
  await h.services.targets.confirm(
    { ...h.ctx, idempotency_key: 'confirm' + date + calories },
    d.id,
    1,
  );
}
it('label_scaling', () => {
  expect(calculateLabel(label)).toEqual({
    calories_kcal: 300,
    carbs_g: 30,
    protein_g: null,
    fat_g: 7.5,
  });
});
it('unknown_is_not_zero', async () => {
  await setup();
  await target();
  await h.services.records.create(h.ctx, food);
  const s = await h.services.summary.forDate('personal', '2026-10-11');
  expect(s.protein_g).toMatchObject({
    known_total: 0,
    incomplete: true,
    remaining: null,
  });
});
it('estimates_mark_budget', async () => {
  await setup();
  await target();
  await h.services.records.create(h.ctx, food);
  expect(
    (await h.services.summary.forDate('personal', '2026-10-11')).calories_kcal,
  ).toMatchObject({ remaining: 1800, estimated: true });
});
it('edit_replaces_meal', async () => {
  await setup();
  const f = await h.services.records.create(h.ctx, food);
  await h.services.records.edit(
    { ...h.ctx, idempotency_key: 'edit' },
    f.entity.id,
    1,
    { nutrition: { ...n, calories_kcal: 300 } },
  );
  expect((await h.services.records.list('personal', {})).items).toHaveLength(1);
  expect(
    (await h.services.summary.forDate('personal', '2026-10-11')).calories_kcal
      .known_total,
  ).toBe(300);
});
it('undo_recomputes_budget', async () => {
  await setup();
  await target();
  const f = await h.services.records.create(h.ctx, food);
  await h.services.records.undo(
    { ...h.ctx, idempotency_key: 'undo' },
    f.entity.id,
    1,
  );
  expect(
    (await h.services.summary.forDate('personal', '2026-10-11')).calories_kcal
      .remaining,
  ).toBe(2000);
});
it('target_history_and_same_day_revision', async () => {
  await setup();
  await target('2026-10-10', 2000);
  await target('2026-10-11', 2200);
  await target('2026-10-11', 2300);
  expect(
    (await h.services.targets.forDate('personal', '2026-10-10')).calories_kcal,
  ).toBe(2000);
  expect(
    (await h.services.targets.forDate('personal', '2026-10-11')).calories_kcal,
  ).toBe(2300);
});
it('backfill_uses_historical_target', async () => {
  await setup();
  await target('2026-10-10', 2000);
  await target('2026-10-11', 2200);
  await h.services.records.create(h.ctx, { ...food, local_date: '2026-10-10' });
  expect(
    (await h.services.summary.forDate('personal', '2026-10-10')).calories_kcal
      .remaining,
  ).toBe(1800);
});
it('incompatible_units_rejected', () => {
  expect(() => calculateLabel({ ...label, consumed_unit: 'ml' })).toThrow();
});
