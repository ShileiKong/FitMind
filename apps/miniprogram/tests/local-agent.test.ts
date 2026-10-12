import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalCore } from '../src/local/core';
import { LocalAgent } from '../src/local/agent';

const time = '2026-10-11T10:00:00Z';
afterEach(() => vi.useRealTimers());
const msg = (text: string, id = 'message-1', extra: any = {}) => ({
  message_id: id,
  conversation_id: 'main',
  text,
  ...extra,
});
const tool = (name: string, args: any, id = 'call-1') => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});
const answer = (content: string | null, tools: any[] = []) => ({
  statusCode: 200,
  data: {
    choices: [
      {
        finish_reason: tools.length ? 'tool_calls' : 'stop',
        message: {
          role: 'assistant',
          content,
          tool_calls: tools,
          reasoning_content: '隐藏思考',
        },
      },
    ],
  },
});
function setup(responses: any[] = [], clock = () => new Date(time)) {
  const storage = new Map<string, any>();
  const requests: any[] = [];
  const platform = {
    getStorageSync: (key: string) => structuredClone(storage.get(key) ?? ''),
    setStorageSync: (key: string, value: any) =>
      storage.set(key, structuredClone(value)),
    removeStorageSync: (key: string) => storage.delete(key),
    request: (options: any) => {
      requests.push(
        structuredClone({
          url: options.url,
          header: options.header,
          data: options.data,
          timeout: options.timeout,
        }),
      );
      const response = responses.shift();
      queueMicrotask(() =>
        response instanceof Error
          ? options.fail(response)
          : options.success(response ?? answer('完成')),
      );
      return { abort() {} };
    },
  };
  const core = new LocalCore(platform, clock);
  const agent = new LocalAgent(core, platform, clock);
  return { storage, platform, requests, core, agent };
}
const water = { amount_ml: 250, date_expression: '今天', note: null };
const target = {
  effective_from: '2026-10-11',
  water_ml: 2000,
  calories_kcal: 2200,
  carbs_g: 250,
  protein_g: 120,
  fat_g: 60,
};
async function workout(h: ReturnType<typeof setup>) {
  const exercise = {
    exercise_id: 'bench',
    name: '卧推',
    variant: '杠铃',
    equipment: 'barbell',
    load_convention: 'total',
    weight_kg: 60,
    increment_kg: 2.5,
    sets: 3,
    reps_min: 10,
    reps_max: 12,
    rest_seconds: 90,
  };
  const draft = await h.core.request(
    'POST',
    '/plans/drafts',
    {
      name: '上肢',
      days: ['2026-10-11', '2026-10-12'].map((local_date) => ({
        local_date,
        name: 'A',
        exercises: [exercise],
      })),
    },
    'plan',
  );
  const active = await h.core.request(
    'POST',
    `/plans/${draft.id}/confirm`,
    { expected_version: 1 },
    'plan-confirm',
  );
  return {
    active,
    first: await h.core.request(
      'POST',
      '/workout-sessions',
      { workout_day_id: active.days[0].id },
      'start',
    ),
  };
}

describe('phone local agent', () => {
  it('finishes a 100-second tool request followed by a 100-second final reply', async () => {
    vi.useFakeTimers();
    const h = setup();
    h.agent.saveModel({ api_key: 'key', model: 'deepseek-flash' });
    let calls = 0;
    h.platform.request = (options: any) => {
      const call = calls++;
      const timer = setTimeout(
        () =>
          options.success(
            call === 0
              ? answer(null, [tool('record_water', water)])
              : answer('已保存'),
          ),
        100000,
      );
      return { abort: () => clearTimeout(timer) };
    };
    const pending = h.agent.run(msg('250ml水'));
    await vi.advanceTimersByTimeAsync(200001);
    const result = await pending;
    expect(result.status).toBe('completed');
    expect(result.record_receipts).toHaveLength(1);
    expect(result.assistant_text).toBe('已保存');
  });

  it('bounds a multi-round attempt to 360 seconds and resumes its saved receipt with a fresh budget', async () => {
    vi.useFakeTimers();
    const h = setup();
    h.agent.saveModel({ api_key: 'key', model: 'deepseek-flash' });
    let calls = 0,
      result: any;
    const timeouts: number[] = [];
    h.platform.request = (options: any) => {
      timeouts.push(options.timeout);
      const call = calls++;
      const timer = setTimeout(
        () =>
          options.success(
            call === 0
              ? answer(null, [tool('record_water', water)])
              : call < 3
                ? answer(null, [tool('get_context', {}, 'context-' + call)])
                : answer('已保存'),
          ),
        call < 4 ? 100000 : 0,
      );
      return {
        abort() {
          clearTimeout(timer);
        },
      };
    };
    const pending = h.agent.run(msg('250ml水')).then((value) => {
      result = value;
      return value;
    });
    await vi.advanceTimersByTimeAsync(360001);
    expect(result).toMatchObject({
      status: 'partial',
      error: { code: 'MODEL_TIMEOUT', retryable: true },
    });
    expect((await pending).record_receipts).toHaveLength(1);
    expect(timeouts).toEqual([120000, 120000, 120000, 60000]);
    const recovering = h.agent.recover('message-1');
    await vi.advanceTimersByTimeAsync(1);
    expect(await recovering).toMatchObject({
      status: 'completed',
      summary: { water_ml: { known_total: 250 } },
    });
    expect(timeouts).toEqual([120000, 120000, 120000, 60000, 120000]);
    expect(
      (await h.core.request('GET', '/records?limit=100')).items,
    ).toHaveLength(1);
  });

  it('allows a text-only final reply after five tool rounds', async () => {
    const h = setup([
      answer(null, [tool('record_water', water)]),
      ...Array.from({ length: 4 }, (_, i) =>
        answer(null, [tool('get_context', {}, 'context-' + i)]),
      ),
      answer('已记录250毫升水。'),
    ]);
    h.agent.saveModel({ api_key: 'key', model: 'deepseek-flash' });
    const result = await h.agent.run(msg('250ml水'));
    expect(result).toMatchObject({
      status: 'completed',
      assistant_text: '已记录250毫升水。',
    });
    expect(result.record_receipts).toHaveLength(1);
    expect(h.requests).toHaveLength(6);
    expect(h.requests[5].data.tools).toBeUndefined();
  });

  it('rejects a tool returned during the text-only final reply without another write', async () => {
    const h = setup([
      ...Array.from({ length: 5 }, (_, i) =>
        answer(null, [tool('get_context', {}, 'context-' + i)]),
      ),
      answer(null, [tool('record_water', water, 'forbidden-final')]),
    ]);
    h.agent.saveModel({ api_key: 'key', model: 'deepseek-flash' });
    const result = await h.agent.run(msg('查询后总结'));
    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'TOOL_LIMIT', retryable: false },
    });
    expect(h.requests).toHaveLength(6);
    expect(h.requests[5].data.tools).toBeUndefined();
    expect((await h.core.request('GET', '/records?limit=100')).items).toEqual(
      [],
    );
  });

  it.each(['{}', '{"amount_ml":'])(
    'does not execute any tool from a truncated model step: %s',
    async (args) => {
      const truncated = answer(null, [
        tool('record_water', water),
        {
          ...tool('record_water', water, 'unfinished'),
          function: { name: 'record_water', arguments: args },
        },
      ]);
      truncated.data.choices[0].finish_reason = 'length';
      const h = setup([truncated]);
      h.agent.saveModel({ api_key: 'key', model: 'deepseek-flash' });
      expect(await h.agent.run(msg('250ml水'))).toMatchObject({
        status: 'failed',
        error: { code: 'MODEL_TRUNCATED', retryable: true },
      });
      expect((await h.core.request('GET', '/records?limit=100')).items).toEqual(
        [],
      );
    },
  );
  it('uses the official direct model boundary and returns saved receipts without reasoning or key in stored data', async () => {
    const h = setup([
      answer(null, [tool('record_water', water)]),
      answer('<think>推理</think>已记录250毫升水。'),
    ]);
    h.agent.saveModel({ api_key: 'secret-key-for-test', model: '' });
    const result = await h.agent.run(msg('刚喝了250毫升水'));
    expect(result.status).toBe('completed');
    expect(result.assistant_text).toBe('已记录250毫升水。');
    expect(result.record_receipts).toHaveLength(1);
    expect(result.record_receipts[0].entity.amount_ml).toBe(250);
    expect(result.affected_dates).toEqual(['2026-10-11']);
    expect(result.summary.water_ml.known_total).toBe(250);
    expect(h.requests[0]).toMatchObject({
      url: 'https://api.deepseek.com/chat/completions',
      header: { Authorization: 'Bearer secret-key-for-test' },
      data: {
        model: 'deepseek-flash',
        thinking: { type: 'disabled' },
        max_tokens: 8192,
      },
    });
    expect(h.requests[0].data.messages[0].content).toContain('设备当前时间');
    expect(
      h.requests[1].data.messages.some(
        (m: any) => m.role === 'tool' && m.content.includes('250'),
      ),
    ).toBe(true);
    expect(
      JSON.stringify(
        [...h.storage].filter(([key]) => key !== 'fitmind.local.model.v1'),
      ),
    ).not.toContain('secret-key-for-test');
    expect(JSON.stringify([...h.storage])).not.toContain('隐藏思考');
    expect(h.agent.messages()[0]).toMatchObject({
      message_id: 'message-1',
      text: '刚喝了250毫升水',
      status: 'completed',
      result: { status: 'completed' },
    });
  });

  it('resumes after a model timeout across midnight and restart without duplicate water', async () => {
    let now = new Date('2026-10-11T15:59:58Z');
    const h = setup(
      [
        answer(null, [tool('record_water', water)]),
        new Error('timeout secret'),
      ],
      () => now,
    );
    h.agent.saveModel({
      api_key: 'secret-key-for-test',
      model: 'deepseek-flash',
    });
    const request = msg('今天喝了250毫升水');
    const first = await h.agent.run(request);
    expect(first).toMatchObject({
      status: 'partial',
      error: { retryable: true },
    });
    expect(first.record_receipts).toHaveLength(1);
    now = new Date('2026-10-11T16:00:02Z');
    await h.core.request(
      'POST',
      '/records',
      { kind: 'water', amount_ml: 500, local_date: '2026-10-12' },
      'new-date-water',
    );
    const restarted = new LocalAgent(
      new LocalCore(h.platform, () => now),
      h.platform,
      () => now,
    );
    const recovered = await restarted.run(request);
    expect(recovered.status).toBe('completed');
    expect(recovered.record_receipts).toHaveLength(1);
    expect(recovered.summary.local_date).toBe('2026-10-11');
    expect(recovered.summary.water_ml.known_total).toBe(250);
    expect(
      (await h.core.request('GET', '/records?limit=100')).items,
    ).toHaveLength(2);
    await restarted.recover(request.message_id);
    expect(h.requests).toHaveLength(3);
    await expect(restarted.run(msg('不同输入'))).rejects.toMatchObject({
      code: 'MESSAGE_CONFLICT',
    });
  });

  it('keeps the original context and conversation boundary when later messages arrive before recovery', async () => {
    const h = setup([
      new Error('offline'),
      answer('后来回复'),
      answer('恢复原消息'),
    ]);
    h.agent.saveModel({ api_key: 'test-key', model: 'deepseek-flash' });
    await h.agent.run(msg('那杯其实是200ml', 'old'));
    await h.core.request(
      'POST',
      '/records',
      { kind: 'water', amount_ml: 500, local_date: '2026-10-11' },
      'later-water',
    );
    await h.agent.run(msg('刚又喝了500ml', 'later'));
    await h.agent.recover('old');
    expect(JSON.stringify(h.requests[2].data.messages)).not.toContain(
      '刚又喝了500ml',
    );
    const context = JSON.parse(
      h.requests[2].data.messages[0].content.split('当前真实状态：')[1],
    );
    expect(context.records).toEqual([]);
  });

  it('fails closed on malformed model tool JSON before any mutation and hides HTTP response errors', async () => {
    const bad = tool('record_water', water);
    bad.function.arguments = '{broken';
    const h = setup([
      answer(null, [tool('record_water', water), bad]),
      { statusCode: 401, data: { error: { message: 'secret-key-for-test' } } },
    ]);
    h.agent.saveModel({
      api_key: 'secret-key-for-test',
      model: 'deepseek-flash',
    });
    expect(await h.agent.run(msg('250ml水'))).toMatchObject({
      status: 'failed',
      error: { code: 'MODEL_FORMAT' },
    });
    expect(
      (await h.core.request('GET', '/records?limit=100')).items,
    ).toHaveLength(0);
    const retried = await h.agent.recover('message-1');
    expect(retried.error?.code).toBe('MODEL_AUTH');
    expect(JSON.stringify(retried)).not.toContain('secret-key-for-test');
  });

  it('returns schema, confirmation and memory-source failures as tool errors without writes', async () => {
    const h = setup([
      answer(null, [
        tool('record_water', { ...water, amount_ml: -4 }),
        tool(
          'confirm_proposal',
          { type: 'target', id: 'invented', expected_version: 1 },
          'confirm',
        ),
        tool('remember', { key: 'equipment', value: '我有杠铃' }, 'memory'),
      ]),
      answer('请核对输入'),
    ]);
    h.agent.saveModel({ api_key: 'key', model: 'deepseek-flash' });
    const result = await h.agent.run(msg('您好'));
    expect(result.tool_errors.map((e) => e.code)).toEqual([
      'INVALID_TOOL_ARGUMENTS',
      'CONFIRMATION_REQUIRED',
      'MEMORY_SOURCE_REQUIRED',
    ]);
    expect(
      (await h.core.request('GET', '/records?limit=100')).items,
    ).toHaveLength(0);
    expect(await h.core.request('GET', '/memories')).toEqual([]);
  });

  it('preserves proposal and explicit confirmation semantics', async () => {
    const h = setup([
      answer(null, [tool('draft_target', { input: target })]),
      answer('目标草案待确认'),
    ]);
    h.agent.saveModel({ api_key: 'key', model: 'deepseek-flash' });
    const result = await h.agent.run(msg('每天喝2000毫升水'));
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({
      type: 'target',
      status: 'draft',
      water_ml: 2000,
    });
    expect(result.summary.water_ml.target).toBe(null);
    const draft = result.proposals[0];
    const p = h.platform.request;
    h.platform.request = (options: any) => {
      queueMicrotask(() =>
        options.success(
          options.data.messages.some((m: any) => m.role === 'tool')
            ? answer('目标已生效')
            : answer(null, [
                tool('confirm_proposal', {
                  type: 'target',
                  id: draft.id,
                  expected_version: draft.version,
                }),
              ]),
        ),
      );
      return { abort() {} };
    };
    const confirmed = await h.agent.run(
      msg('确认草案', 'confirm-message', {
        confirmation: {
          type: 'target',
          id: draft.id,
          expected_version: draft.version,
        },
      }),
    );
    expect(confirmed.summary.water_ml.target).toBe(2000);
    h.platform.request = p;
  });

  it('drops deleted memory sources from frozen context and earlier tool results on recovery', async () => {
    const h = setup([
      answer(null, [
        tool('remember', { key: 'equipment', value: '我只有哑铃' }),
      ]),
      answer('已记住'),
      answer(null, [tool('get_context', {})]),
      new Error('timeout'),
      answer('恢复'),
    ]);
    h.agent.saveModel({ api_key: 'key', model: 'deepseek-flash' });
    await h.agent.run(msg('我只有哑铃', 'source'));
    await h.agent.run(msg('制定安排', 'pending'));
    const memory = (await h.core.request('GET', '/memories'))[0];
    await h.core.request(
      'POST',
      `/memories/${memory.id}/forget`,
      { expected_version: memory.version },
      'forget',
    );
    await h.agent.recover('pending');
    expect(JSON.stringify(h.requests.at(-1).data.messages)).not.toContain(
      '我只有哑铃',
    );
    expect(h.agent.messages().some((m: any) => m.message_id === 'source')).toBe(
      false,
    );
  });

  it('records unambiguous water and weight without a key or network and reports actual remaining budget', async () => {
    const h = setup();
    const draft = await h.core.request(
      'POST',
      '/targets/drafts',
      target,
      'target',
    );
    await h.core.request(
      'POST',
      `/targets/${draft.id}/confirm`,
      { expected_version: draft.version },
      'confirm',
    );
    const recorded = await h.agent.run(msg('刚喝了300毫升水', 'water'));
    expect(recorded).toMatchObject({
      status: 'completed',
      summary: { water_ml: { known_total: 300, remaining: 1700 } },
    });
    expect(recorded.assistant_text).toContain('1700');
    expect(await h.agent.run(msg('昨天体重72.5公斤', 'weight'))).toMatchObject({
      status: 'completed',
      affected_dates: ['2026-10-10'],
    });
    const query = await h.agent.run(msg('今天还剩多少水', 'remaining'));
    expect(query.assistant_text).toContain('1700');
    expect(query.record_receipts).toEqual([]);
    const budget = await h.agent.run(msg('今天还剩多少额度', 'budget'));
    expect(budget.assistant_text).toContain('1700');
    expect(budget.assistant_text).toContain('2200');
    expect(h.requests).toEqual([]);
    expect(h.agent.modelSettings.model).toBe('deepseek-flash');
  });

  it('records the actual current set locally and returns its recommendation without inventing unspecified weight', async () => {
    const h = setup();
    const { first } = await workout(h);
    const result = await h.agent.run(msg('这组做了12次，轻松'));
    expect(result.record_receipts).toHaveLength(1);
    expect(result.record_receipts[0]).toMatchObject({
      session_id: first.id,
      exercise_id: 'bench',
      weight_kg: null,
      reps: 12,
    });
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0].type).toBe('next_set');
    expect(
      (await h.core.request('GET', `/workout-sessions/${first.id}`)).sets,
    ).toHaveLength(1);
    expect(h.requests).toEqual([]);
  });

  it('describes the real next-set recommendation when actual weight and difficulty were supplied', async () => {
    const h = setup();
    await workout(h);
    const result = await h.agent.run(msg('这组60kg做了12次，轻松'));
    expect(result.recommendations[0]).toMatchObject({
      weight_kg: 62.5,
      reason_code: 'INCREASE_LOAD',
    });
    expect(result.assistant_text).toContain('下一组');
    expect(result.assistant_text).toContain('62.5');
    expect(result.record_receipts[0].weight_kg).toBe(60);
  });

  it('keeps the original workout binding if another session becomes active before the model returns', async () => {
    const args = {
      session_id: null,
      exercise_id: null,
      weight_kg: 60,
      reps: 12,
      difficulty: 'easy',
      rpe: null,
      pain: false,
      reduce: false,
    };
    const h = setup();
    const { first, active } = await workout(h);
    h.agent.saveModel({ api_key: 'key', model: 'deepseek-flash' });
    let next: any,
      firstRequest = true;
    h.platform.request = (options: any) => {
      queueMicrotask(async () => {
        if (firstRequest) {
          firstRequest = false;
          await h.core.request(
            'POST',
            `/workout-sessions/${first.id}/transition`,
            { action: 'complete', expected_version: first.version },
            'complete',
          );
          next = await h.core.request(
            'POST',
            '/workout-sessions',
            { workout_day_id: active.days[1].id },
            'next',
          );
          options.success(answer(null, [tool('record_set', args)]));
        } else options.success(answer('请核对训练会话'));
      });
      return { abort() {} };
    };
    const result = await h.agent.run(msg('刚60kg做了12次'));
    expect(result.tool_errors).toEqual([
      expect.objectContaining({ code: 'SESSION_INACTIVE' }),
    ]);
    expect(
      (await h.core.request('GET', `/workout-sessions/${next.id}`)).sets,
    ).toEqual([]);
  });

  it('checks current versions rather than overwriting a later edit through a frozen model context', async () => {
    const h = setup();
    const receipt = await h.core.request(
      'POST',
      '/records',
      { kind: 'water', amount_ml: 300, local_date: '2026-10-11' },
      'water-record',
    );
    await h.core.request(
      'PATCH',
      `/records/${receipt.entity.id}`,
      { expected_version: 1, patch: { amount_ml: 400 } },
      'edit',
    );
    h.agent.saveModel({ api_key: 'key', model: 'deepseek-flash' });
    h.platform.request = (options: any) => {
      queueMicrotask(() =>
        options.success(
          options.data.messages.some((m: any) => m.role === 'tool')
            ? answer('记录已变化，请核对')
            : answer(null, [
                tool('edit_record', {
                  id: receipt.entity.id,
                  expected_version: 1,
                  patch_json: JSON.stringify({ amount_ml: 200 }),
                }),
              ]),
        ),
      );
      return { abort() {} };
    };
    const result = await h.agent.run(msg('那杯改成200ml'));
    expect(result.tool_errors).toEqual([
      expect.objectContaining({ code: 'VERSION_CONFLICT' }),
    ]);
    expect(
      (await h.core.request('GET', `/records/${receipt.entity.id}`)).amount_ml,
    ).toBe(400);
  });

  it('deduplicates simultaneous submission of the same logical message', async () => {
    const h = setup([
      answer(null, [tool('record_water', water)]),
      answer('已保存'),
    ]);
    h.agent.saveModel({ api_key: 'key', model: 'deepseek-flash' });
    const results = await Promise.all([
      h.agent.run(msg('250ml水')),
      h.agent.run(msg('250ml水')),
    ]);
    expect(results.map((r) => r.status)).toEqual(['completed', 'completed']);
    expect(h.agent.messages()).toHaveLength(1);
    expect(
      (await h.core.request('GET', '/records?limit=100')).items,
    ).toHaveLength(1);
    expect(h.requests).toHaveLength(2);
  });

  it('resumes persisted pending tool intent after its atomic side effect was committed but the reply boundary failed', async () => {
    const h = setup([
      answer(null, [tool('record_water', water)]),
      answer('已保存'),
    ]);
    h.agent.saveModel({ api_key: 'key', model: 'deepseek-flash' });
    const write = h.platform.setStorageSync;
    let crash = true;
    h.platform.setStorageSync = (key, value) => {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      if (
        crash &&
        parsed?.entities?.some((row: any) => row.kind === 'record') &&
        parsed.entities.some(
          (row: any) => row.kind === 'message' && row.value.round === 1,
        )
      ) {
        crash = false;
        throw new Error('disk failed after atomic tool commit');
      }
      write(key, value);
    };
    const first = await h.agent.run(msg('250ml水'));
    expect(first.status).toBe('partial');
    expect(first.record_receipts).toHaveLength(1);
    const restarted = new LocalAgent(new LocalCore(h.platform), h.platform);
    const result = await restarted.recover('message-1');
    expect(result.status).toBe('completed');
    expect(result.record_receipts).toHaveLength(1);
    expect(result.summary.water_ml.known_total).toBe(250);
  });

  it('does not store personal chat data for the settings connection test and clears only the independent key', async () => {
    const h = setup([answer('连接成功')]);
    h.agent.saveModel({ api_key: 'key', model: 'deepseek-flash' });
    await h.agent.testModel();
    expect(h.agent.messages()).toEqual([]);
    expect(JSON.stringify(h.requests[0].data.messages)).not.toContain(
      'profile',
    );
    await h.agent.run(msg('300ml水', 'local-record-after-clear'));
    h.agent.clearModel();
    expect(h.agent.modelSettings.api_key).toBe('');
    expect(h.agent.messages()).toHaveLength(1);
  });

  it('compacts repeated plan context while preserving every training date and day identity', async () => {
    const h = setup([answer('请查看计划')]);
    const exercises = ['卧推', '深蹲', '划船'].map((name, index) => ({
      exercise_id: 'movement-' + index,
      name,
      variant: '杠铃',
      equipment: 'barbell',
      load_convention: 'total',
      weight_kg: 60,
      increment_kg: 2.5,
      sets: 3,
      reps_min: 10,
      reps_max: 12,
      rest_seconds: 90,
    }));
    const plan = await h.core.request(
      'POST',
      '/plans/drafts',
      {
        name: '八周训练',
        weekly: {
          start_date: '2026-10-11',
          end_date: '2026-12-05',
          days: [1, 3, 5].map((weekday) => ({
            weekday,
            name: '力量',
            exercises,
          })),
        },
      },
      'long-plan',
    );
    h.agent.saveModel({ api_key: 'key', model: 'deepseek-flash' });
    await h.agent.run(msg('查看安排'));
    const context = JSON.parse(
      h.requests[0].data.messages[0].content.split('当前真实状态：')[1],
    );
    const compact = context.plans[0];
    expect(compact.weekly_blocks).toHaveLength(3);
    expect(
      compact.weekly_blocks
        .flatMap((block: any) => block.days.map((day: any) => day.id))
        .sort(),
    ).toEqual(plan.days.map((day: any) => day.id).sort());
    expect(compact.weekly_blocks[0].exercises).toHaveLength(3);
    expect(JSON.stringify(compact).length).toBeLessThan(
      JSON.stringify(plan).length * 0.65,
    );
    expect(h.agent.messages()[0].result?.status).toBe('completed');
  });

  it.each([
    '喝了300或500毫升水',
    '今天喝了300ml水，昨天喝了200ml水',
    '体重70公斤，喝了300毫升水',
    '计划明天喝300毫升水',
    '没有喝300毫升水',
    '喝了2杯水',
    '吃了一碗面',
    '做了两组，每组12次',
  ])('asks for clarification without mutation for %s', async (text) => {
    const h = setup();
    const result = await h.agent.run(msg(text));
    expect(result.status).toBe('completed');
    expect(result.record_receipts).toEqual([]);
    expect(
      (await h.core.request('GET', '/records?limit=100')).items,
    ).toHaveLength(0);
    expect(result.assistant_text.length).toBeGreaterThan(0);
    expect(h.requests).toEqual([]);
  });

  it('rejects unsupported attachments and invalid capture dates without network or mutation', async () => {
    const h = setup();
    await expect(
      h.agent.run(msg('图片', 'attachment', { attachment_ids: ['image'] })),
    ).rejects.toMatchObject({ code: 'MEDIA_UNSUPPORTED' });
    await expect(
      h.agent.run(
        msg('300ml水', 'wrong-capture', {
          offline_queued: true,
          captured_at: time,
          capture_timezone: 'Asia/Shanghai',
          capture_local_date: '2026-10-10',
        }),
      ),
    ).rejects.toMatchObject({ code: 'CAPTURE_DATE_MISMATCH' });
  });
});
