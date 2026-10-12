import { afterEach, expect, it } from 'vitest';
import { makeHarness } from './helpers.js';
import { executeTool } from '../src/modules/agent/tools.js';

let h: any;
afterEach(async () => {
  if (h) await h.close();
  h = null;
});
const nutrition = { calories_kcal: 100, carbs_g: 10, protein_g: 5, fat_g: 2 };
async function record(id: string, date = '2026-10-11', value = nutrition) {
  return h.services.records.create(
    { ...h.ctx, idempotency_key: id },
    {
      kind: 'food',
      name: id,
      source: 'estimate',
      assumptions: '一份',
      local_date: date,
      nutrition: value,
    },
  );
}
async function target() {
  const d = await h.services.targets.draft(
    { ...h.ctx, idempotency_key: 'draft' },
    {
      effective_from: '2026-10-11',
      water_ml: 2500,
      calories_kcal: 2400,
      carbs_g: 300,
      protein_g: 150,
      fat_g: 67,
    },
  );
  await h.services.targets.confirm(
    { ...h.ctx, idempotency_key: 'confirm' },
    d.id,
    1,
  );
}
it('reads every food record and remaining budget for the message day without logging a recommendation', async () => {
  h = await makeHarness();
  await target();
  for (let i = 0; i < 105; i++) await record('food-' + i);
  await record('yesterday', '2026-10-10');
  const removed = await record('removed');
  await h.services.records.undo(
    { ...h.ctx, idempotency_key: 'undo' },
    removed.entity.id,
    1,
  );
  const context = await executeTool(
    h.app,
    h.ctx,
    { text: '下一餐吃什么' },
    'get_nutrition_context',
    {},
  );
  expect(context.local_date).toBe('2026-10-11');
  expect(context.foods).toHaveLength(105);
  expect(context.budgets.calories_kcal).toMatchObject({
    known_total: 10500,
    remaining: 0,
    over: 8100,
    estimated: true,
  });
  expect(context.budgets.protein_g.known_total).toBe(525);
  expect(
    context.foods.some((f: any) => ['yesterday', 'removed'].includes(f.name)),
  ).toBe(false);
  expect(
    (await h.services.records.list('personal', { limit: 500 })).items,
  ).toHaveLength(106);
});
it('keeps unknown separate from zero and labels provisional balances with and without a target', async () => {
  h = await makeHarness();
  await record('unknown', '2026-10-11', {
    ...nutrition,
    protein_g: null,
  } as any);
  let context = await h.services.memory.nutritionContext(
    'personal',
    '2026-10-11',
  );
  expect(context.budgets.protein_g).toMatchObject({
    target: null,
    known_total: 0,
    remaining: null,
    provisional_remaining: null,
    incomplete: true,
  });
  await target();
  context = await h.services.memory.nutritionContext('personal', '2026-10-11');
  expect(context.budgets.protein_g).toMatchObject({
    remaining: null,
    provisional_remaining: 150,
    incomplete: true,
  });
  expect(context.foods[0].nutrition.protein_g).toBeNull();
});
it('refreshes real food data before each model step including food saved in this message', async () => {
  const inputs: any[] = [];
  h = await makeHarness({
    providers: {
      text: {
        next: async (input: any) => {
          inputs.push(
            JSON.parse(input.instructions.split('当前真实状态：')[1]),
          );
          if (inputs.length === 1)
            return {
              assistant_text: '',
              tool_calls: [
                {
                  call_id: 'food',
                  name: 'record_food',
                  arguments: {
                    date_expression: '今天',
                    input: {
                      kind: 'food',
                      name: '午饭',
                      source: 'estimate',
                      assumptions: '一份',
                      nutrition,
                    },
                  },
                },
              ],
            };
          return {
            assistant_text: '晚餐可以补充蛋白质和蔬菜。',
            tool_calls: [],
          };
        },
      },
    },
  });
  await target();
  const result = await h.services.agent.submit(h.ctx, {
    message_id: 'meal',
    conversation_id: 'main',
    text: '午饭吃了一份饭，帮我记录并推荐晚餐',
  });
  expect(result.status).toBe('completed');
  expect(inputs[0].nutrition_context.foods).toHaveLength(0);
  expect(inputs[1].nutrition_context.foods[0].name).toBe('午饭');
  expect(inputs[1].nutrition_context.budgets.calories_kcal.remaining).toBe(
    2300,
  );
  expect(result.record_receipts).toHaveLength(1);
});
