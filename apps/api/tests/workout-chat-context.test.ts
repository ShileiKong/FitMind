import { it, expect } from 'vitest';
import { makeHarness } from './helpers.js';
it('chat_records_the_captured_workout_never_a_later_session', async () => {
  let h: any, first: any, second: any;
  let calls = 0;
  const provider = {
    next: async () => {
      if (calls++) return { assistant_text: '请核对训练会话', tool_calls: [] };
      await h.services.workouts.transition(
        { ...h.ctx, idempotency_key: 'end-first' },
        first.id,
        first.version,
        { action: 'complete' },
      );
      second = await h.services.workouts.start(
        { ...h.ctx, idempotency_key: 'start-second' },
        second.workout_day_id,
      );
      return {
        tool_calls: [
          {
            call_id: 'set',
            name: 'record_set',
            arguments: {
              session_id: null,
              exercise_id: null,
              weight_kg: 100,
              reps: 8,
              difficulty: 'hard',
              rpe: null,
              pain: false,
              reduce: false,
            },
          },
        ],
      };
    },
  };
  h = await makeHarness({ providers: { text: provider } });
  try {
    const exercise = {
      exercise_id: 'bench',
      name: '卧推',
      variant: '杠铃',
      equipment: 'barbell',
      load_convention: 'total',
      weight_kg: 100,
      increment_kg: 2.5,
      sets: 3,
      reps_min: 10,
      reps_max: 12,
      rest_seconds: 90,
    };
    const draft = await h.services.plans.createDraft(
      { ...h.ctx, idempotency_key: 'plan' },
      {
        name: '上肢',
        days: ['2026-10-11', '2026-10-12'].map((local_date) => ({
          local_date,
          name: 'A',
          exercises: [exercise],
        })),
      },
    );
    const active = await h.services.plans.confirm(
      { ...h.ctx, idempotency_key: 'confirm' },
      draft.id,
      1,
    );
    first = await h.services.workouts.start(
      { ...h.ctx, idempotency_key: 'start' },
      active.days[0].id,
    );
    second = { workout_day_id: active.days[1].id };
    const result = await h.services.agent.submit(h.ctx, {
      message_id: 'training-message',
      conversation_id: 'main',
      text: '刚刚100公斤做了8次很吃力',
    });
    expect(h.services.workouts.get('personal', second.id).sets).toHaveLength(0);
    expect(result.tool_errors).toEqual([
      expect.objectContaining({ code: 'SESSION_INACTIVE' }),
    ]);
  } finally {
    await h.close();
  }
});
