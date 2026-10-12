import { it, expect } from 'vitest';
import { makeHarness } from './helpers.js';
import { executeTool } from '../src/modules/agent/tools.js';
it('agent_queries_a_real_history_range', async () => {
  const h = await makeHarness();
  try {
    await h.services.records.create(h.ctx, {
      kind: 'water',
      amount_ml: 500,
      local_date: '2026-10-10',
    });
    const result = await executeTool(
      h.app,
      h.ctx,
      { message_id: 'query', conversation_id: 'main', text: '上周喝水记录' },
      'query_history',
      {
        start_date: '2026-10-01',
        end_date: '2026-10-11',
        kind: 'water',
        cursor: null,
      },
    );
    expect(result.items[0].amount_ml).toBe(500);
  } finally {
    await h.close();
  }
});
it('agent_can_undo_a_specific_actual_set', async () => {
  const h = await makeHarness();
  try {
    const e = {
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
    const p = await h.services.plans.createDraft(
      { ...h.ctx, idempotency_key: 'plan' },
      {
        name: '上肢',
        days: [{ local_date: '2026-10-11', name: 'A', exercises: [e] }],
      },
    );
    const active = await h.services.plans.confirm(
      { ...h.ctx, idempotency_key: 'confirm' },
      p.id,
      1,
    );
    const w = await h.services.workouts.start(
      { ...h.ctx, idempotency_key: 'start' },
      active.days[0].id,
    );
    const actual = await h.services.workouts.recordSet(
      { ...h.ctx, idempotency_key: 'set' },
      w.id,
      { exercise_id: 'bench', weight_kg: 100, reps: 8 },
    );
    await executeTool(
      h.app,
      { ...h.ctx, idempotency_key: 'undo' },
      { message_id: 'undo', conversation_id: 'main', text: '撤销这组' },
      'undo_set',
      { id: actual.set.id, expected_version: 1 },
    );
    expect(h.services.workouts.get('personal', w.id).sets).toHaveLength(0);
  } finally {
    await h.close();
  }
});
