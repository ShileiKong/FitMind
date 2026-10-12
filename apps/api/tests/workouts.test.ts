import { it, expect, afterEach } from 'vitest';
import { makeHarness } from './helpers.js';
let h: any;
afterEach(async () => {
  if (h) await h.close();
  h = null;
});
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
async function setup() {
  h = await makeHarness();
  const p = await h.services.plans.createDraft(h.ctx, {
    name: '上肢',
    days: [
      {
        name: 'A',
        local_date: '2026-10-11',
        exercises: [e, { ...e, exercise_id: 'row', name: '划船' }],
      },
    ],
  });
  const a = await h.services.plans.confirm(
    { ...h.ctx, idempotency_key: 'confirm' },
    p.id,
    1,
  );
  return h.services.workouts.start(
    { ...h.ctx, idempotency_key: 'start' },
    a.days[0].id,
  );
}
const set = {
  exercise_id: 'bench',
  weight_kg: 100,
  reps: 8,
  difficulty: 'hard',
  pain: false,
};
it('one_active_session', async () => {
  const w = await setup();
  expect(
    (
      await h.services.workouts.start(
        { ...h.ctx, idempotency_key: 'other' },
        w.workout_day_id,
      )
    ).id,
  ).toBe(w.id);
});
it('resume_keeps_current_exercise', async () => {
  const w = await setup();
  await h.services.workouts.transition(
    { ...h.ctx, idempotency_key: 'switch' },
    w.id,
    w.version,
    { action: 'switch', exercise_id: 'row' },
  );
  await h.reopen();
  expect(h.services.workouts.get('personal', w.id).current_exercise_id).toBe(
    'row',
  );
});
it('duplicate_set_does_not_advance_twice', async () => {
  const w = await setup();
  const a = await h.services.workouts.recordSet(h.ctx, w.id, set);
  const b = await h.services.workouts.recordSet(h.ctx, w.id, set);
  expect(a.set.id).toBe(b.set.id);
  expect(h.services.workouts.get('personal', w.id).sets).toHaveLength(1);
});
it('missing_weight_stays_null', async () => {
  const w = await setup();
  expect(
    (
      await h.services.workouts.recordSet(h.ctx, w.id, {
        exercise_id: 'bench',
        reps: 8,
      })
    ).set.weight_kg,
  ).toBeNull();
});
it('cross_midnight_keeps_session_day', async () => {
  const w = await setup();
  const a = await h.services.workouts.recordSet(
    {
      ...h.ctx,
      now_utc: '2026-10-11T17:00:00Z',
      reference_local_date: '2026-10-12',
    },
    w.id,
    set,
  );
  expect(a.set.local_date).toBe('2026-10-11');
  expect(a.recommendation.weight_kg).toBe(97.5);
});
it('edit_invalidates_old_suggestion', async () => {
  const w = await setup();
  const a = await h.services.workouts.recordSet(h.ctx, w.id, set);
  await h.services.workouts.editSet(
    { ...h.ctx, idempotency_key: 'edit' },
    a.set.id,
    1,
    { reps: 12, difficulty: 'easy' },
  );
  expect(
    h.services.workouts
      .recommendations('personal', w.id)
      .find((x: any) => x.id === a.recommendation.id).status,
  ).toBe('invalidated');
});
it('early_start_uses_actual_day_and_date_correction_updates_sets', async () => {
  const w = await setup();
  await h.services.workouts.transition(
    { ...h.ctx, idempotency_key: 'abandon' },
    w.id,
    w.version,
    { action: 'abandon' },
  );
  const early = await h.services.workouts.start(
    { ...h.ctx, idempotency_key: 'early', reference_local_date: '2026-10-10' },
    w.workout_day_id,
  );
  expect(early.local_date).toBe('2026-10-10');
  const actual = await h.services.workouts.recordSet(
    { ...h.ctx, idempotency_key: 'actual' },
    early.id,
    set,
  );
  const corrected = await h.services.workouts.transition(
    { ...h.ctx, idempotency_key: 'date' },
    early.id,
    actual.session.version,
    { action: 'change_date', local_date: '2026-10-09' },
  );
  expect(corrected.sets[0].local_date).toBe('2026-10-09');
  expect(corrected.snapshot.local_date).toBe('2026-10-11');
});
it('edited_set_recomputes_next_recommendation', async () => {
  const w = await setup();
  const a = await h.services.workouts.recordSet(h.ctx, w.id, set);
  await h.services.workouts.editSet(
    { ...h.ctx, idempotency_key: 'edit' },
    a.set.id,
    1,
    { reps: 12, difficulty: 'easy' },
  );
  const rs = h.services.workouts.recommendations('personal', w.id);
  expect(
    rs.find(
      (r: any) =>
        r.status === 'proposed' &&
        r.basis.some((b: any) => b.id === a.set.id && b.version === 2),
    )?.weight_kg,
  ).toBe(102.5);
});
