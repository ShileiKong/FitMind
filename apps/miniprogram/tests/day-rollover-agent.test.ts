import { describe, expect, it } from 'vitest';
import { LocalCore } from '../src/local/core';
import { LocalAgent } from '../src/local/agent';
import { platformStore } from './local-fixtures';

const nutrition = { calories_kcal: 600, carbs_g: 70, protein_g: 30, fat_g: 22 };
const food = (name: string, calories = 600, date_expression = '今天') => ({
  id: name,
  type: 'function',
  function: {
    name: 'record_food',
    arguments: JSON.stringify({
      date_expression,
      input: {
        kind: 'food',
        name,
        source: 'estimate',
        assumptions: '一份',
        nutrition: { ...nutrition, calories_kcal: calories },
      },
    }),
  },
});
const reply = (text: string, calls: any[] = []) => ({
  statusCode: 200,
  data: {
    choices: [
      {
        finish_reason: calls.length ? 'tool_calls' : 'stop',
        message: { content: text, tool_calls: calls },
      },
    ],
  },
});
function setup(responses: any[]) {
  let now = new Date('2026-10-12T15:59:58Z');
  const inputs: any[] = [];
  const platform = {
    ...platformStore(),
    request(options: any) {
      inputs.push(structuredClone(options.data.messages));
      const value = responses.shift();
      queueMicrotask(() =>
        value instanceof Error
          ? options.fail(value)
          : options.success(value ?? reply('完成')),
      );
      return { abort() {} };
    },
  };
  const core = new LocalCore(platform, () => now);
  const agent = new LocalAgent(core, platform, () => now);
  agent.saveModel({ api_key: 'synthetic-key', model: 'deepseek-flash' });
  return {
    core,
    agent,
    inputs,
    setTime: (time: string) => {
      now = new Date(time);
    },
  };
}
const request = (id: string, text: string) => ({
  message_id: id,
  conversation_id: 'main',
  text,
});
const context = (messages: any[]) =>
  JSON.parse(messages[0].content.split('当前真实状态：')[1]);
async function target(core: LocalCore) {
  const draft = await core.request(
    'POST',
    '/targets/drafts',
    {
      effective_from: '2026-10-12',
      water_ml: 2500,
      calories_kcal: 2400,
      carbs_g: 300,
      protein_g: 150,
      fat_g: 67,
    },
    'target',
  );
  await core.request(
    'POST',
    `/targets/${draft.id}/confirm`,
    { expected_version: 1 },
    'confirm',
  );
}

describe('agent natural-day boundary', () => {
  it('labels an offline rules balance with its original date instead of today', async () => {
    const h = setup([]);
    h.agent.clearModel();
    await target(h.core);
    await h.core.request(
      'POST',
      '/records',
      { kind: 'water', amount_ml: 1500 },
      'old-water',
    );
    h.setTime('2026-10-12T16:00:01Z');
    const result = await h.agent.run({
      ...request('offline-balance', '今天还剩多少水'),
      offline_queued: true,
      captured_at: '2026-10-12T15:59:58Z',
      capture_timezone: 'Asia/Shanghai',
      capture_local_date: '2026-10-12',
    });
    expect(result.assistant_text).toBe('2026-10-12饮水还剩1000毫升。');
    expect(
      (await h.core.request('GET', '/days/2026-10-13/summary')).water_ml
        .remaining,
    ).toBe(2500);
  });

  it('refreshes the ledger when recovering an interrupted rules balance query', async () => {
    const h = setup([]);
    h.agent.clearModel();
    await target(h.core);
    await h.agent.run(request('balance', '今天还剩多少热量'));
    const saved = h.core.store.get<any>('personal', 'message', 'balance');
    saved.status = 'running';
    saved.result = null;
    h.core.store.transaction(() =>
      h.core.store.put('personal', 'message', saved),
    );
    await h.core.request(
      'POST',
      '/records',
      {
        kind: 'food',
        name: '晚餐',
        source: 'estimate',
        assumptions: '一份',
        nutrition,
      },
      'old-dinner',
    );
    h.setTime('2026-10-12T16:00:01Z');
    const result = await h.agent.recover('balance');
    expect(result.assistant_text).toBe(
      '2026-10-12热量还剩1800千卡（含估算）。',
    );
    const recovered = h.core.store.get<any>('personal', 'message', 'balance');
    expect(recovered.context_snapshot.current_time.local_date).toBe(
      '2026-10-13',
    );
    expect(
      recovered.context_snapshot.current_day_summary.calories_kcal.remaining,
    ).toBe(2400);
    expect(recovered.ctx.reference_local_date).toBe('2026-10-12');
  });

  it('labels a delayed rules record with its original day and keeps today empty', async () => {
    const h = setup([]);
    h.agent.clearModel();
    await target(h.core);
    h.setTime('2026-10-12T16:00:01Z');
    const queued = {
      ...request('offline-water', '喝了300毫升水'),
      offline_queued: true,
      captured_at: '2026-10-12T15:59:58Z',
      capture_timezone: 'Asia/Shanghai',
      capture_local_date: '2026-10-12',
    };
    const result = await h.agent.run(queued);
    expect(result.assistant_text).toBe(
      '已记录300毫升水。归属2026-10-12。当日还剩2200毫升。',
    );
    await h.agent.run(queued);
    expect(
      (await h.core.request('GET', '/days/2026-10-13/summary')).water_ml
        .known_total,
    ).toBe(0);
    expect(
      (await h.core.request('GET', '/records?limit=100')).items,
    ).toHaveLength(1);
  });

  it('recovers dates for legacy undated snapshots using the original offline message day', async () => {
    const h = setup([
      reply('', [food('补记晚餐')]),
      reply('已保存。'),
      new Error('offline'),
      reply('可以吃早餐。'),
    ]);
    h.setTime('2026-10-12T16:00:01Z');
    await h.agent.run({
      ...request('offline-old', '今天晚餐吃了一份饭'),
      offline_queued: true,
      captured_at: '2026-10-12T15:59:58Z',
      capture_timezone: 'Asia/Shanghai',
      capture_local_date: '2026-10-12',
    });
    const partial = await h.agent.run(request('followup', '现在早餐吃什么'));
    expect(partial.status).toBe('failed');
    const saved = h.core.store.get<any>('personal', 'message', 'followup');
    for (const prior of saved.prior_snapshot) {
      delete prior.created_at;
      delete prior.reference_local_date;
      delete prior.timezone;
    }
    h.core.store.transaction(() =>
      h.core.store.put('personal', 'message', saved),
    );
    await h.agent.recover('followup');
    const turns = h.inputs[3].slice(1, -1);
    for (const turn of turns) {
      expect(turn.content).toContain('相对日期基准 2026-10-12');
      expect(turn.content).toContain('发送时间 2026-10-12T16:00:01.000Z');
    }
    expect(context(h.inputs[3]).message_reference_date).toBe('2026-10-13');
    expect(context(h.inputs[3]).today_summary.calories_kcal.known_total).toBe(
      0,
    );
  });

  it('labels yesterday history and starts a new calorie budget without moving or replaying old food', async () => {
    const h = setup([
      reply('', [food('晚餐')]),
      reply('今天已摄入600千卡，还剩1800。'),
      reply('', [food('早餐', 200)]),
      reply('早餐已记录。'),
    ]);
    await target(h.core);
    const old = request('old', '今天晚餐吃了一份饭');
    await h.agent.run(old);
    h.setTime('2026-10-12T16:00:01Z');
    const result = await h.agent.run(request('new', '今天早餐吃了一份饭'));
    const first = context(h.inputs[2]);
    expect(first.current_time.local_date).toBe('2026-10-13');
    expect(first.today_summary.calories_kcal.known_total).toBe(0);
    expect(first.nutrition_context.budgets.calories_kcal.remaining).toBe(2400);
    const prior = h.inputs[2].slice(1, -1);
    expect(prior).toHaveLength(2);
    for (const turn of prior) {
      expect(turn.content).toContain('2026-10-12');
      expect(turn.content).toContain('2026-10-12T15:59:58.000Z');
      expect(turn.content).toContain('历史对话');
    }
    expect(context(h.inputs[3]).today_summary.calories_kcal.known_total).toBe(
      200,
    );
    expect(result.summary?.calories_kcal.known_total).toBe(200);
    await h.agent.run(old);
    expect(
      (await h.core.request('GET', '/records?limit=100')).items,
    ).toHaveLength(2);
    expect(
      (await h.core.request('GET', '/days/2026-10-12/summary')).calories_kcal
        .known_total,
    ).toBe(600);
  });

  it('rechecks live time on recovery while keeping a delayed write on its original day', async () => {
    const h = setup([
      reply('', [food('晚餐')]),
      new Error('offline'),
      reply('昨日晚餐已记录。'),
    ]);
    await target(h.core);
    const partial = await h.agent.run(request('old', '晚餐吃了一份饭'));
    expect(partial.status).toBe('partial');
    h.setTime('2026-10-12T16:00:01Z');
    await h.core.request(
      'POST',
      '/records',
      {
        kind: 'food',
        name: '早餐',
        source: 'estimate',
        assumptions: '一份',
        nutrition: { ...nutrition, calories_kcal: 200 },
      },
      'breakfast',
    );
    const recovered = await h.agent.recover('old');
    const state = context(h.inputs[2]);
    expect(state.current_time).toMatchObject({
      local_date: '2026-10-13',
      now_utc: '2026-10-12T16:00:01.000Z',
    });
    expect(state.message_reference_date).toBe('2026-10-12');
    expect(state.today_summary).toMatchObject({
      local_date: '2026-10-12',
      calories_kcal: { known_total: 600 },
    });
    expect(state.current_day_summary).toMatchObject({
      local_date: '2026-10-13',
      calories_kcal: { known_total: 200, remaining: 2200 },
    });
    expect(state.records).toHaveLength(1);
    expect(recovered.record_receipts).toHaveLength(1);
    expect(recovered.summary?.calories_kcal.known_total).toBe(600);
    expect(
      (await h.core.request('GET', '/records?limit=100')).items,
    ).toHaveLength(2);
  });

  it('resolves explicit yesterday from the new day and keeps today totals independent', async () => {
    const h = setup([
      reply('', [food('补记晚餐', 600, '昨天')]),
      reply('昨日晚餐已补记。'),
    ]);
    h.setTime('2026-10-12T16:00:01Z');
    const result = await h.agent.run(
      request('backdate', '补记昨天晚餐吃了一份饭'),
    );
    expect(result.record_receipts[0]).toMatchObject({
      entity: { local_date: '2026-10-12' },
    });
    expect(result.summary?.calories_kcal.known_total).toBe(0);
    expect(
      context(h.inputs[1]).relevant_summary.calories_kcal.known_total,
    ).toBe(600);
    expect(context(h.inputs[1]).records[0]).toMatchObject({
      local_date: '2026-10-12',
      name: '补记晚餐',
    });
  });
});
