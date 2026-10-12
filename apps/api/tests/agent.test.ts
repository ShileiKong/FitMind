import { it, expect, afterEach } from 'vitest';
import { makeHarness } from './helpers.js';
let h: any;
afterEach(async () => {
  if (h) await h.close();
  h = null;
});
const chat = {
  message_id: 'message-1',
  conversation_id: 'main',
  text: '今天喝了 300ml 水',
};
const call = {
  name: 'record_water',
  arguments: { amount_ml: 300, date_expression: '今天', note: null },
  call_id: 'c1',
};
async function setup(steps: any[]) {
  let i = 0;
  h = await makeHarness({
    providers: {
      text: {
        next: async () => {
          const s = steps[i++];
          if (s instanceof Error) throw s;
          return s ?? { assistant_text: '已完成', tool_calls: [] };
        },
      },
    },
  });
  return h;
}
it('chat_records_water', async () => {
  await setup([{ tool_calls: [call], assistant_text: '' }]);
  const r = await h.services.agent.submit(h.ctx, chat);
  expect(r.status).toBe('completed');
  expect(r.record_receipts).toHaveLength(1);
  expect(
    (await h.services.summary.forDate('personal', '2026-10-11')).water_ml
      .known_total,
  ).toBe(300);
});
it('retry_recovers_saved_commands', async () => {
  await setup([{ tool_calls: [call] }, new Error('timeout')]);
  await h.services.agent.submit(h.ctx, chat);
  await h.reopen();
  await h.services.agent.recover(h.ctx, chat.message_id);
  expect((await h.services.records.list('personal')).items).toHaveLength(1);
});
it('reply_timeout_keeps_receipt', async () => {
  await setup([{ tool_calls: [call] }, new Error('timeout')]);
  const r = await h.services.agent.submit(h.ctx, chat);
  expect(r.status).toBe('partial');
  expect(r.record_receipts).toHaveLength(1);
});
it('relative_date_survives_midnight_retry', async () => {
  await setup([
    {
      tool_calls: [
        { ...call, arguments: { ...call.arguments, date_expression: '昨天' } },
      ],
    },
    new Error('timeout'),
  ]);
  await h.services.agent.submit(h.ctx, chat);
  await h.services.agent.recover(
    { ...h.ctx, reference_local_date: '2026-10-12' },
    chat.message_id,
  );
  expect((await h.services.records.list('personal')).items[0].local_date).toBe(
    '2026-10-10',
  );
});
it('unknown_tool_rejected', async () => {
  await setup([
    { tool_calls: [{ name: 'delete_database', arguments: {}, call_id: 'x' }] },
  ]);
  const r = await h.services.agent.submit(h.ctx, chat);
  expect(r.record_receipts).toEqual([]);
  expect(r.tool_errors[0].code).toBe('UNKNOWN_TOOL');
});
it('tool_loop_is_bounded', async () => {
  await setup(
    Array.from({ length: 8 }, () => ({
      tool_calls: [{ name: 'get_context', arguments: {}, call_id: 'g' }],
    })),
  );
  const r = await h.services.agent.submit(h.ctx, chat);
  expect(r.status).toBe('failed');
  expect(r.error.code).toBe('TOOL_LIMIT');
});
it('ambiguous_edit_needs_input', async () => {
  await setup([
    {
      tool_calls: [
        {
          name: 'edit_record',
          arguments: {
            id: null,
            expected_version: null,
            patch: { amount_ml: 400 },
          },
          call_id: 'e',
        },
      ],
    },
  ]);
  const r = await h.services.agent.submit(h.ctx, chat);
  expect(r.tool_errors).toHaveLength(1);
});
it('goal_and_plan_need_confirmation', async () => {
  await setup([
    {
      tool_calls: [
        {
          name: 'confirm_proposal',
          arguments: { type: 'target', id: 'no', expected_version: 1 },
          call_id: 'x',
        },
      ],
    },
  ]);
  const r = await h.services.agent.submit(h.ctx, {
    ...chat,
    text: '请制定目标',
  });
  expect(r.tool_errors[0].code).toBe('CONFIRMATION_REQUIRED');
});
it('training_input_uses_active_exercise', async () => {
  await setup([
    {
      tool_calls: [
        {
          name: 'record_set',
          arguments: {
            session_id: null,
            exercise_id: null,
            weight_kg: 40,
            reps: 10,
            difficulty: 'normal',
            rpe: null,
            pain: false,
            reduce: false,
          },
          call_id: 's',
        },
      ],
    },
  ]);
  const e = {
    exercise_id: 'bench',
    name: '卧推',
    variant: '杠铃',
    equipment: 'barbell',
    load_convention: 'total',
    weight_kg: 40,
    increment_kg: 2.5,
    sets: 3,
    reps_min: 8,
    reps_max: 12,
    rest_seconds: 90,
  };
  const p = await h.services.plans.createDraft(h.ctx, {
    name: 'A',
    days: [{ name: 'A', local_date: '2026-10-11', exercises: [e] }],
  });
  const a = await h.services.plans.confirm(
    { ...h.ctx, idempotency_key: 'c' },
    p.id,
    1,
  );
  const w = await h.services.workouts.start(
    { ...h.ctx, idempotency_key: 's' },
    a.days[0].id,
  );
  await h.services.agent.submit(h.ctx, { ...chat, text: '这个动作40公斤10次' });
  expect(h.services.workouts.get('personal', w.id).sets[0].exercise_id).toBe(
    'bench',
  );
});
