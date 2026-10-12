import { expect, it } from 'vitest';
import { LocalCore } from '../src/local/core';
import { LocalAgent } from '../src/local/agent';

it('phone-local meal advice refreshes the ledger after writing intake and preserves original natural day on recovery', async () => {
  let now = new Date('2026-10-11T15:59:58Z');
  const storage = new Map();
  const inputs: any[] = [];
  const platform = {
    getStorageSync: (k: string) => structuredClone(storage.get(k) ?? ''),
    setStorageSync: (k: string, v: any) => storage.set(k, structuredClone(v)),
    removeStorageSync: (k: string) => storage.delete(k),
    request: (options: any) => {
      inputs.push(
        JSON.parse(options.data.messages[0].content.split('当前真实状态：')[1]),
      );
      const i = inputs.length;
      queueMicrotask(() => {
        if (i === 2) {
          options.fail({ errMsg: 'network unavailable' });
          return;
        }
        const calls =
          i === 1
            ? [
                {
                  id: 'food',
                  type: 'function',
                  function: {
                    name: 'record_food',
                    arguments: JSON.stringify({
                      date_expression: '今天',
                      input: {
                        kind: 'food',
                        name: '午饭',
                        source: 'estimate',
                        assumptions: '一份',
                        nutrition: {
                          calories_kcal: 700,
                          carbs_g: 90,
                          protein_g: 30,
                          fat_g: 20,
                        },
                      },
                    }),
                  },
                },
              ]
            : [];
        options.success({
          statusCode: 200,
          data: {
            choices: [
              {
                finish_reason: calls.length ? 'tool_calls' : 'stop',
                message: {
                  content: calls.length
                    ? null
                    : '晚餐建议一份鱼、蔬菜和适量米饭。',
                  tool_calls: calls,
                },
              },
            ],
          },
        });
      });
      return { abort() {} };
    },
  };
  const core = new LocalCore(platform, () => now);
  const agent = new LocalAgent(core, platform, () => now);
  agent.saveModel({ api_key: 'synthetic-test-key', model: 'deepseek-flash' });
  const draft = await core.request(
    'POST',
    '/targets/drafts',
    {
      effective_from: '2026-10-11',
      water_ml: 2500,
      calories_kcal: 2400,
      carbs_g: 300,
      protein_g: 150,
      fat_g: 67,
    },
    'draft',
  );
  await core.request(
    'POST',
    `/targets/${draft.id}/confirm`,
    { expected_version: 1 },
    'confirm',
  );
  const request = {
    message_id: 'meal',
    conversation_id: 'main',
    text: '记录午饭，推荐下一餐',
  };
  const partial = await agent.run(request);
  expect(partial.status).toBe('partial');
  expect(inputs[1].nutrition_context.foods[0].name).toBe('午饭');
  expect(inputs[1].nutrition_context.budgets.calories_kcal.remaining).toBe(
    1700,
  );
  now = new Date('2026-10-11T16:00:01Z');
  await core.request(
    'POST',
    '/records',
    {
      kind: 'food',
      name: '第二天食物',
      source: 'estimate',
      assumptions: '一份',
      nutrition: { calories_kcal: 200, carbs_g: 20, protein_g: 10, fat_g: 9 },
    },
    'tomorrow-food',
  );
  const completed = await agent.recover('meal');
  expect(completed.status).toBe('completed');
  expect(inputs[2].nutrition_context.local_date).toBe('2026-10-11');
  expect(inputs[2].nutrition_context.foods).toHaveLength(1);
  expect(inputs[2].nutrition_context.foods[0].name).toBe('午饭');
  expect(completed.record_receipts).toHaveLength(1);
  expect((await core.request('GET', '/records?limit=100')).items).toHaveLength(
    2,
  );
});
