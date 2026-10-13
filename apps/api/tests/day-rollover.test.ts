import { afterEach, expect, it } from 'vitest';
import { makeHarness } from './helpers.js';

let h: any;
afterEach(async () => {
  if (h) await h.close();
  h = null;
});

function capture(input: any) {
  return {
    context: JSON.parse(input.instructions.split('当前真实状态：')[1]),
    transcript: structuredClone(input.transcript),
  };
}

function waterCall(amount_ml: number) {
  return {
    call_id: 'water',
    name: 'record_water',
    arguments: { amount_ml, date_expression: '今天', note: null },
  };
}

async function setTarget(key: string, water_ml: number) {
  const draft = await h.services.targets.draft(
    { ...h.ctx, idempotency_key: key + '-draft' },
    {
      effective_from: '2026-10-11',
      water_ml,
      calories_kcal: 2000,
      carbs_g: 250,
      protein_g: 100,
      fat_g: 60,
    },
  );
  return h.services.targets.confirm(
    { ...h.ctx, idempotency_key: key + '-confirm' },
    draft.id,
    1,
  );
}

it('gives a new-day follow-up an empty current ledger and dates both prior chat roles', async () => {
  let now = new Date('2026-10-11T15:50:00.000Z');
  const seen: any[] = [];
  h = await makeHarness({
    clock: () => now,
    providers: {
      text: {
        next: async (input: any) => {
          seen.push(capture(input));
          return { assistant_text: '今天已喝 500 毫升。', tool_calls: [] };
        },
      },
    },
  });
  await h.services.records.create(
    { ...h.ctx, idempotency_key: 'prior-water' },
    { kind: 'water', amount_ml: 500, local_date: '2026-10-11' },
  );
  await h.services.records.create(
    { ...h.ctx, idempotency_key: 'prior-food' },
    {
      kind: 'food',
      name: '前一天的晚饭',
      source: 'estimate',
      assumptions: '一份',
      local_date: '2026-10-11',
      nutrition: {
        calories_kcal: 600,
        carbs_g: 75,
        protein_g: 30,
        fat_g: 20,
      },
    },
  );
  await h.services.agent.submit(h.ctx, {
    message_id: 'before-midnight',
    conversation_id: 'main',
    text: '今天喝了多少水',
  });

  now = new Date('2026-10-11T16:10:00.000Z');
  const result = await h.services.agent.submit(
    { ...h.ctx, now_utc: now.toISOString() },
    {
      message_id: 'after-midnight',
      conversation_id: 'main',
      text: '今天还需要喝多少水',
    },
  );

  expect(result.status).toBe('completed');
  expect(seen[1].context.current_time).toMatchObject({
    now_utc: '2026-10-11T16:10:00.000Z',
    local_date: '2026-10-12',
    timezone: 'Asia/Shanghai',
  });
  expect(seen[1].context.message_reference_date).toBe('2026-10-12');
  expect(seen[1].context.today_summary.water_ml.known_total).toBe(0);
  expect(seen[1].context.today_summary.calories_kcal.known_total).toBe(0);
  expect(seen[1].context.current_day_summary.water_ml.known_total).toBe(0);
  expect(seen[1].context.nutrition_context.foods).toEqual([]);
  expect(seen[1].context.records).toEqual([]);
  for (const prior of seen[1].transcript.slice(0, 2)) {
    expect(prior.content).toContain('2026-10-11T15:50:00.000Z');
    expect(prior.content).toContain('2026-10-11');
    expect(prior.content).toContain('Asia/Shanghai');
  }
  expect(seen[1].transcript[0].role).toBe('user');
  expect(seen[1].transcript[1].role).toBe('assistant');
  expect(seen[1].transcript.at(-1).content).toBe('今天还需要喝多少水');
  expect(
    (await h.services.summary.forDate('personal', '2026-10-11')).water_ml
      .known_total,
  ).toBe(500);
  expect(
    (await h.services.summary.forDate('personal', '2026-10-11')).calories_kcal
      .known_total,
  ).toBe(600);
});

it('refreshes the clock and water ledger for a second model round without moving the write date', async () => {
  let now = new Date('2026-10-11T15:59:00.000Z');
  const seen: any[] = [];
  h = await makeHarness({
    clock: () => now,
    providers: {
      text: {
        next: async (input: any) => {
          seen.push(capture(input));
          if (seen.length === 1) {
            now = new Date('2026-10-11T16:01:00.000Z');
            return { assistant_text: '', tool_calls: [waterCall(250)] };
          }
          return { assistant_text: '已保存。', tool_calls: [] };
        },
      },
    },
  });
  const result = await h.services.agent.submit(h.ctx, {
    message_id: 'midnight-write',
    conversation_id: 'main',
    text: '今天喝了 250 毫升水',
  });

  expect(result.status).toBe('completed');
  expect(seen[0].context.today_summary.water_ml.known_total).toBe(0);
  expect(seen[1].context.current_time).toMatchObject({
    now_utc: '2026-10-11T16:01:00.000Z',
    local_date: '2026-10-12',
  });
  expect(seen[1].context.message_reference_date).toBe('2026-10-11');
  expect(seen[1].context.today_summary).toMatchObject({
    local_date: '2026-10-11',
    record_count: 1,
    water_ml: { known_total: 250 },
  });
  expect(seen[1].context.relevant_summary.water_ml.known_total).toBe(250);
  expect(seen[1].context.records).toEqual([
    expect.objectContaining({
      kind: 'water',
      amount_ml: 250,
      local_date: '2026-10-11',
    }),
  ]);
  expect(seen[1].context.current_day_summary).toMatchObject({
    local_date: '2026-10-12',
    water_ml: { known_total: 0 },
  });
  const record = (await h.services.records.list('personal')).items[0];
  expect(record.local_date).toBe('2026-10-11');
  expect(record.recorded_at).toBe('2026-10-11T15:59:00.000Z');
  expect(result.summary.local_date).toBe('2026-10-11');
});

it('reopens a partial reply with live time and updated ledgers while replaying its saved receipt only once', async () => {
  let now = new Date('2026-10-11T15:59:00.000Z');
  const seen: any[] = [];
  h = await makeHarness({
    clock: () => now,
    providers: {
      text: {
        next: async (input: any) => {
          seen.push(capture(input));
          if (seen.length === 1)
            return { assistant_text: '', tool_calls: [waterCall(250)] };
          if (seen.length === 2)
            throw new Error('synthetic provider interruption');
          return { assistant_text: '已恢复。', tool_calls: [] };
        },
      },
    },
  });
  await setTarget('initial', 2000);
  const request = {
    message_id: 'recover-old-day',
    conversation_id: 'main',
    text: '今天喝了 250 毫升水',
  };
  const partial = await h.services.agent.submit(h.ctx, request);
  expect(partial.status).toBe('partial');

  now = new Date('2026-10-13T02:00:00.000Z');
  await setTarget('updated', 3000);
  await h.services.records.create(
    { ...h.ctx, idempotency_key: 'additional-water' },
    { kind: 'water', amount_ml: 100, local_date: '2026-10-11' },
  );
  await h.services.records.create(
    { ...h.ctx, idempotency_key: 'additional-food' },
    {
      kind: 'food',
      name: '补录午饭',
      source: 'estimate',
      assumptions: '一份',
      local_date: '2026-10-11',
      nutrition: { calories_kcal: 400, carbs_g: 50, protein_g: 20, fat_g: 12 },
    },
  );
  await h.reopen();
  const result = await h.services.agent.recover(
    {
      ...h.ctx,
      now_utc: now.toISOString(),
      reference_local_date: '2026-10-13',
    },
    request.message_id,
  );

  expect(result.status).toBe('completed');
  const context = seen[2].context;
  expect(context.current_time).toMatchObject({
    now_utc: '2026-10-13T02:00:00.000Z',
    local_date: '2026-10-13',
  });
  expect(context.message_reference_date).toBe('2026-10-11');
  expect(context.target.water_ml).toBe(3000);
  expect(context.today_summary).toMatchObject({
    local_date: '2026-10-11',
    record_count: 3,
    water_ml: { known_total: 350, remaining: 2650 },
    calories_kcal: { known_total: 400 },
  });
  expect(context.relevant_summary.water_ml.known_total).toBe(350);
  expect(context.nutrition_context.foods[0].name).toBe('补录午饭');
  expect(context.records).toHaveLength(3);
  expect(context.current_day_summary).toMatchObject({
    local_date: '2026-10-13',
    record_count: 0,
    water_ml: { known_total: 0 },
  });
  expect(result.record_receipts).toHaveLength(1);
  expect(result.record_receipts[0].entity.recorded_at).toBe(
    '2026-10-11T15:59:00.000Z',
  );
  expect(result.summary.local_date).toBe('2026-10-11');
  await h.services.agent.recover(h.ctx, request.message_id);
  await h.services.agent.submit(h.ctx, request);
  expect(seen).toHaveLength(3);
  expect((await h.services.records.list('personal')).items).toHaveLength(3);
  expect(
    (await h.services.summary.forDate('personal', '2026-10-13')).water_ml
      .known_total,
  ).toBe(0);
  const state = JSON.parse(
    h.app.store.db
      .prepare('SELECT context FROM messages WHERE id=?')
      .get(request.message_id).context,
  );
  expect(state.ctx.now_utc).toBe('2026-10-11T15:59:00.000Z');
  expect(state.ctx.reference_local_date).toBe('2026-10-11');
});

it('uses the original message context for offline prior history and repairs legacy snapshots on recovery', async () => {
  let now = new Date('2026-10-12T02:00:00.000Z');
  const seen: any[] = [];
  h = await makeHarness({
    clock: () => now,
    providers: {
      text: {
        next: async (input: any) => {
          seen.push(capture(input));
          if (seen.length === 2)
            throw new Error('synthetic provider interruption');
          return { assistant_text: '今天的记录已核对。', tool_calls: [] };
        },
      },
    },
  });
  const offline = {
    message_id: 'offline-prior',
    conversation_id: 'main',
    text: '今天的水已记录',
    offline_queued: true,
    captured_at: '2026-10-11T12:00:00.000Z',
    capture_timezone: 'Asia/Shanghai',
    capture_local_date: '2026-10-11',
  };
  await h.services.agent.submit(h.ctx, offline);
  // A legacy result may carry a summary for a different queried date. The
  // message's frozen context remains the authority for its relative words.
  const priorRow = h.app.store.db
    .prepare('SELECT result FROM messages WHERE id=?')
    .get(offline.message_id);
  const priorResult = JSON.parse(priorRow.result);
  priorResult.summary.local_date = '2026-10-10';
  h.app.store.db
    .prepare('UPDATE messages SET result=? WHERE id=?')
    .run(JSON.stringify(priorResult), offline.message_id);

  const request = {
    message_id: 'legacy-recovery',
    conversation_id: 'main',
    text: '今天情况如何',
  };
  await h.services.agent.submit(h.ctx, request);
  for (const prior of seen[1].transcript.slice(0, 2)) {
    expect(prior.content).toContain('2026-10-11');
    expect(prior.content).toContain('2026-10-12T02:00:00.000Z');
    expect(prior.content).toContain('Asia/Shanghai');
    expect(prior.content).not.toContain('2026-10-10');
  }

  const row = h.app.store.db
    .prepare('SELECT context FROM messages WHERE id=?')
    .get(request.message_id);
  const state = JSON.parse(row.context);
  for (const prior of state.prior_snapshot) {
    delete prior.reference_local_date;
    delete prior.timezone;
  }
  h.app.store.db
    .prepare('UPDATE messages SET context=? WHERE id=?')
    .run(JSON.stringify(state), request.message_id);
  now = new Date('2026-10-13T02:00:00.000Z');
  await h.reopen();
  const result = await h.services.agent.recover(h.ctx, request.message_id);
  expect(result.status).toBe('completed');
  for (const prior of seen[2].transcript.slice(0, 2)) {
    expect(prior.content).toContain('2026-10-11');
    expect(prior.content).toContain('2026-10-12T02:00:00.000Z');
    expect(prior.content).toContain('Asia/Shanghai');
    expect(prior.content).not.toContain('2026-10-10');
  }
});
