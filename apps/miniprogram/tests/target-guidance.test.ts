import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalClient } from '../src/local/client';
import { chatView } from '../src/lib/view';
import { platformStore } from './local-fixtures';

afterEach(() => vi.unstubAllGlobals());
const clock = () => new Date('2026-10-11T10:00:00Z');
const fitness = {
  height_cm: 177,
  weight_kg: 72,
  sex: 'unspecified',
  goal: '减脂，保持力量',
  strength_training: 'yes',
  availability_text: '每周三次力量训练，平时坐办公室',
  equipment: '健身房',
};
const target = {
  effective_from: '2026-10-11',
  water_ml: 2400,
  calories_kcal: 2200,
  carbs_g: 280,
  protein_g: 132,
  fat_g: 62,
};

async function createChat(
  input: any = target,
  text = '请结合我的资料制定每日营养目标，缺少选填信息你先估算。',
) {
  const requests: any[] = [];
  const platform = {
    ...platformStore(),
    request(options: any) {
      requests.push(structuredClone(options.data));
      const drafting = requests.length === 1;
      // Controlled provider fixtures verify the real draft/card pipeline. They
      // do not claim to evaluate live model reasoning or nutrition estimates.
      queueMicrotask(() =>
        options.success({
          statusCode: 200,
          data: {
            choices: [
              {
                finish_reason: drafting ? 'tool_calls' : 'stop',
                message: {
                  role: 'assistant',
                  content: drafting
                    ? null
                    : '已生成估算目标，可调整。点击下方卡片确认并应用。',
                  tool_calls: drafting
                    ? [
                        {
                          id: 'synthetic-target-call',
                          type: 'function',
                          function: {
                            name: 'draft_target',
                            arguments: JSON.stringify({ input }),
                          },
                        },
                      ]
                    : [],
                },
              },
            ],
          },
        }),
      );
      return { abort() {} };
    },
  };
  const c = new LocalClient(platform, clock);
  await c.mutate('/profile', { expected_version: 0, fitness }, 'PATCH');
  c.agent.saveModel({
    api_key: 'synthetic-target-test-key',
    model: 'deepseek-flash',
  });
  await c.refresh();
  const result = await c.sendChat(text);
  await c.refresh();
  return { c, requests, result };
}

describe('personalized target model boundary', () => {
  it('sends saved fitness and complete estimation guidance with the target tool, then exposes the saved draft card', async () => {
    const { c, requests, result } = await createChat();
    const first = requests[0];
    const [instructions, serialized] =
      first.messages[0].content.split('当前真实状态：');
    const context = JSON.parse(serialized);
    expect(context.profile.fitness).toEqual(fitness);
    expect(instructions).toMatch(/目标.*(?:活动|训练水平)/);
    expect(instructions).toMatch(/选填.*(?:估算|假设)/);
    expect(instructions).toMatch(/宏量.*热量.*(?:一致|协调)/);
    expect(instructions).toMatch(/(?:下方|回复内).*卡片.*确认并应用/);
    const tool = first.tools.find(
      (t: any) => t.function.name === 'draft_target',
    ).function;
    expect(tool.description).toMatch(/(?:身高|体重).*目标/);
    expect(tool.description).toMatch(/(?:完整|整套).*五项/);
    expect(result.proposals).toMatchObject([
      { type: 'target', status: 'draft', ...target },
    ]);
    expect(c.data.summary.calories_kcal.target).toBeNull();
    const card = chatView(c.data.messages, {
      ...c.data,
      pending: c.pending(),
    })[0].proposals[0];
    expect(card).toMatchObject({
      canConfirm: true,
      confirmLabel: '确认并应用',
      timingHint: '确认后从今日起使用这些每日额度。',
    });
    for (const value of ['2200 kcal', '2400 ml', '280 g', '132 g', '62 g'])
      expect(card.preview).toContain(value);
  });

  it('preserves an explicitly requested water-only draft without manufacturing nutrition values', async () => {
    const { result, c } = await createChat(
      {
        effective_from: '2026-10-11',
        water_ml: 2300,
        calories_kcal: null,
        carbs_g: null,
        protein_g: null,
        fat_g: null,
      },
      '只把每天饮水目标设为2300毫升，不设置营养目标。',
    );
    expect(result.proposals[0]).toMatchObject({
      status: 'draft',
      water_ml: 2300,
      calories_kcal: null,
      carbs_g: null,
      protein_g: null,
      fat_g: null,
    });
    expect(c.data.summary.water_ml.target).toBeNull();
  });

  it('provides actual eaten food and remaining nutrition with next-meal guidance and leaves suggestions unrecorded', async () => {
    const requests: any[] = [];
    const c = new LocalClient(
      {
        ...platformStore(),
        request(options: any) {
          requests.push(structuredClone(options.data));
          queueMicrotask(() =>
            options.success({
              statusCode: 200,
              data: {
                choices: [
                  {
                    finish_reason: 'stop',
                    message: {
                      role: 'assistant',
                      content:
                        '晚餐可选一碗米饭、鸡肉和一盘蔬菜，份量按食欲调整。',
                      tool_calls: [],
                    },
                  },
                ],
              },
            }),
          );
          return { abort() {} };
        },
      },
      clock,
    );
    const draft = await c.mutate('/targets/drafts', target);
    await c.mutate('/targets/' + draft.id + '/confirm', {
      expected_version: draft.version,
    });
    await c.mutate('/records', {
      kind: 'food',
      name: '已吃的午饭',
      source: 'estimate',
      nutrition: { calories_kcal: 400, carbs_g: 50, protein_g: 20, fat_g: 10 },
      assumptions: '按一份普通午饭估算。',
    });
    c.agent.saveModel({
      api_key: 'synthetic-meal-test-key',
      model: 'deepseek-flash',
    });
    await c.sendChat('今晚吃什么？只是问建议，还没吃。');
    const [instructions, serialized] =
      requests[0].messages[0].content.split('当前真实状态：');
    const context = JSON.parse(serialized);
    expect(context.nutrition_context).toMatchObject({
      local_date: '2026-10-11',
      target: { status: 'active', calories_kcal: 2200 },
      foods: [{ name: '已吃的午饭', nutrition: { calories_kcal: 400 } }],
      budgets: {
        calories_kcal: { known_total: 400, remaining: 1800 },
        protein_g: { known_total: 20, remaining: 112 },
      },
    });
    expect(instructions).toMatch(/下一餐.*nutrition_context/);
    expect(instructions).toMatch(/一餐.*(?:全部|全天).*余额/);
    expect(instructions).toMatch(/provisional_remaining.*暂估/);
    expect(instructions).toMatch(/建议.*(?:不自动记录|不能.*记录)/);
    expect((await c.request('GET', '/records?kind=food')).items).toHaveLength(
      1,
    );
  });
});
