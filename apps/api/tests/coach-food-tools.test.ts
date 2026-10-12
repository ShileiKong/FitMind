import { afterEach, expect, it } from 'vitest';
import { executeTool } from '../src/modules/agent/tools.js';
import { makeHarness } from './helpers.js';

let h: any;
afterEach(async () => {
  if (h) await h.close();
  h = null;
});
const request = {
  message_id: 'synthetic-meal',
  conversation_id: 'main',
  text: '225毫升纯牛奶，两份番茄牛肉面一共500g；不知道热量，请估算。',
};
// Hand-specified tool fixtures test the real ledger, not model interpretation.
const milk = {
  kind: 'food',
  name: '纯牛奶225ml',
  source: 'estimate',
  nutrition: { calories_kcal: 135, carbs_g: 11, protein_g: 7, fat_g: 7 },
  assumptions: '按225ml常见全脂纯牛奶估算，每100ml约60千卡。',
};
const noodles = {
  kind: 'food',
  name: '两份番茄牛肉面（合计500g）',
  source: 'estimate',
  nutrition: { calories_kcal: 750, carbs_g: 90, protein_g: 35, fat_g: 25 },
  assumptions:
    '两份合计500g，按熟面、牛肉、番茄及常见油量估算；合计重量不再乘2。',
};
async function setup(providers?: any) {
  h = await makeHarness({ providers });
  const draft = await h.services.targets.draft(
    { ...h.ctx, idempotency_key: 'target-draft' },
    {
      effective_from: '2026-10-11',
      water_ml: 2000,
      calories_kcal: 2200,
      carbs_g: 250,
      protein_g: 120,
      fat_g: 60,
    },
  );
  await h.services.targets.confirm(
    { ...h.ctx, idempotency_key: 'target-confirm' },
    draft.id,
    1,
  );
  await h.services.records.create(
    { ...h.ctx, idempotency_key: 'previous-water' },
    { kind: 'water', amount_ml: 1400 },
  );
}
function record(input: any, key: string) {
  return executeTool(
    h.app,
    { ...h.ctx, idempotency_key: key, source_message_id: request.message_id },
    request,
    'record_food',
    { input, date_expression: '今天' },
  );
}

it('saves common-portion estimates with their assumptions and actual estimated budgets while retaining earlier water', async () => {
  await setup();
  const dairy: any = await record(milk, 'milk');
  const meal: any = await record(noodles, 'noodles');
  expect(dairy.entity).toMatchObject({
    source: 'estimate',
    assumptions: milk.assumptions,
    nutrition: { calories_kcal: 135 },
  });
  expect(meal.entity).toMatchObject({
    source: 'estimate',
    assumptions: noodles.assumptions,
    nutrition: { calories_kcal: 750 },
  });
  expect(
    await h.services.summary.forDate('personal', '2026-10-11'),
  ).toMatchObject({
    record_count: 3,
    water_ml: { known_total: 1400, remaining: 600 },
    calories_kcal: { known_total: 885, remaining: 1315, estimated: true },
    protein_g: { known_total: 42, remaining: 78 },
  });
});

it('keeps unknown estimated nutrients unknown and rejects estimates without an explicit assumption', async () => {
  await setup();
  await expect(
    record({ ...milk, assumptions: ' ' }, 'missing-assumption'),
  ).rejects.toMatchObject({ code: 'PORTION_REQUIRED' });
  await record(
    { ...milk, nutrition: { ...milk.nutrition, fat_g: null } },
    'unknown-fat',
  );
  const summary = await h.services.summary.forDate('personal', '2026-10-11');
  expect(summary.fat_g).toMatchObject({ incomplete: true, remaining: null });
  expect((await h.services.records.list('personal')).items).toHaveLength(2);
});

it('uses the nutritional label and consumed amount for accurate milk even when supplied nutrition differs', async () => {
  await setup();
  const receipt: any = await record(
    {
      ...milk,
      source: 'label',
      nutrition: {
        calories_kcal: 999,
        carbs_g: 999,
        protein_g: 999,
        fat_g: 999,
      },
      assumptions: undefined,
      label: {
        basis_quantity: 100,
        basis_unit: 'ml',
        consumed_quantity: 225,
        consumed_unit: 'ml',
        nutrition_per_basis: {
          calories_kcal: 60,
          carbs_g: 4.8,
          protein_g: 3.2,
          fat_g: 3.3,
        },
      },
    },
    'label-milk',
  );
  expect(receipt.entity.nutrition).toEqual({
    calories_kcal: 135,
    carbs_g: 10.8,
    protein_g: 7.2,
    fat_g: 7.425,
  });
  expect(
    (await h.services.summary.forDate('personal', '2026-10-11')).calories_kcal
      .estimated,
  ).toBe(false);
});

it('corrects an existing estimated meal rather than creating a second meal or changing earlier water', async () => {
  await setup();
  const receipt: any = await record(noodles, 'original-meal');
  const corrected: any = await executeTool(
    h.app,
    { ...h.ctx, idempotency_key: 'meal-correction' },
    { ...request, text: '那两份合计其实是250g，请更正。' },
    'edit_record',
    {
      id: receipt.entity.id,
      expected_version: 1,
      patch_json: JSON.stringify({
        name: '两份番茄牛肉面（合计250g）',
        nutrition: {
          calories_kcal: 375,
          carbs_g: 45,
          protein_g: 17.5,
          fat_g: 12.5,
        },
        assumptions: '用户更正两份合计250g，原份量估算减半。',
      }),
    },
  );
  expect(corrected.entity.id).toBe(receipt.entity.id);
  expect(corrected.entity.version).toBe(2);
  expect(
    await h.services.summary.forDate('personal', '2026-10-11'),
  ).toMatchObject({
    record_count: 2,
    water_ml: { known_total: 1400 },
    calories_kcal: { known_total: 375, remaining: 1825 },
  });
});

it('recovers interrupted receipt delivery for two estimated foods without replaying food or prior water', async () => {
  const steps: any[] = [
    {
      assistant_text: '',
      tool_calls: [milk, noodles].map((input, index) => ({
        name: 'record_food',
        arguments: { input, date_expression: '今天' },
        call_id: 'food-' + index,
      })),
    },
    new Error('synthetic reply timeout'),
    {
      assistant_text: '两项食物已按常见份量估算记录，可随时更正。',
      tool_calls: [],
    },
  ];
  await setup({
    text: {
      next: async () => {
        const step = steps.shift();
        if (step instanceof Error) throw step;
        return step;
      },
    },
  });
  const result = await h.services.agent.submit(h.ctx, request);
  expect(result).toMatchObject({
    status: 'partial',
    summary: { calories_kcal: { known_total: 885 } },
  });
  expect(result.record_receipts).toHaveLength(2);
  await h.reopen();
  const recovered = await h.services.agent.submit(h.ctx, request);
  expect(recovered.status).toBe('completed');
  expect(recovered.record_receipts).toHaveLength(2);
  const records = (await h.services.records.list('personal')).items;
  expect(records).toHaveLength(3);
  expect(
    records
      .filter((entry: any) => entry.kind === 'water')
      .map((entry: any) => entry.amount_ml),
  ).toEqual([1400]);
});

it('saves explicit coach setup facts through the real profile tool while preserving earlier fitness facts', async () => {
  await setup();
  const initial = await executeTool(
    h.app,
    { ...h.ctx, idempotency_key: 'setup-profile' },
    {
      ...request,
      text: '我172cm、65kg，不透露性别，想减脂，每周三晚训练，有哑铃。',
    },
    'update_profile',
    {
      expected_version: 0,
      patch_json: JSON.stringify({
        fitness: {
          height_cm: 172,
          weight_kg: 65,
          sex: 'unspecified',
          goal: '减脂',
          strength_training: 'yes',
          availability_text: '每周三晚',
          equipment: '哑铃',
        },
        onboarding_status: 'in_progress',
      }),
    },
  );
  const changed: any = await executeTool(
    h.app,
    { ...h.ctx, idempotency_key: 'weight-correction' },
    { ...request, text: '体重更正为66kg' },
    'update_profile',
    {
      expected_version: (initial as any).version,
      patch_json: JSON.stringify({ fitness: { weight_kg: 66 } }),
    },
  );
  expect(changed.fitness).toMatchObject({
    height_cm: 172,
    weight_kg: 66,
    sex: 'unspecified',
    goal: '减脂',
    availability_text: '每周三晚',
    equipment: '哑铃',
  });
  expect(changed.onboarding_status).toBe('in_progress');
  expect(
    h.services.targets.forDate('personal', '2026-10-11').calories_kcal,
  ).toBe(2200);
  expect(h.services.plans.list('personal')).toEqual([]);
});
