import { it, expect, afterEach } from 'vitest';
import { makeHarness } from './helpers.js';
let h: any;
afterEach(async () => {
  if (h) await h.close();
  h = null;
});
const ex = {
  exercise_id: 'bench',
  name: '卧推',
  variant: '杠铃平板',
  equipment: 'barbell',
  load_convention: 'total',
  weight_kg: 40,
  increment_kg: 2.5,
  sets: 3,
  reps_min: 8,
  reps_max: 12,
  rest_seconds: 90,
};
async function setup(clock?: any) {
  h = await makeHarness(clock ? { clock } : {});
  return h;
}
async function draft() {
  return h.services.plans.createDraft(h.ctx, {
    name: '上肢',
    days: [{ local_date: '2026-10-12', name: '上肢 A', exercises: [ex] }],
  });
}
async function active() {
  const p = await draft();
  return h.services.plans.confirm(
    { ...h.ctx, idempotency_key: 'confirm' },
    p.id,
    1,
  );
}
it('draft_is_not_active', async () => {
  await setup();
  await draft();
  expect(await h.services.reminders.list('personal')).toEqual([]);
});
it('all_views_share_day', async () => {
  await setup();
  const p = await active();
  expect(h.services.plans.getDay('personal', p.days[0].id)).toEqual(
    h.services.plans.days('personal')[0],
  );
});
it('confirm_expands_week', async () => {
  await setup();
  const p = await h.services.plans.createDraft(h.ctx, {
    name: '循环',
    repeat: {
      start_date: '2026-10-12',
      end_date: '2026-10-25',
      weekdays: [1, 4],
      name: '上肢',
      exercises: [ex],
    },
  });
  const a = await h.services.plans.confirm(
    { ...h.ctx, idempotency_key: 'c' },
    p.id,
    1,
  );
  expect(a.days).toHaveLength(4);
});
it('reschedule_replaces_reminder', async () => {
  await setup();
  const p = await active();
  const before = await h.services.reminders.list('personal');
  expect(before[0].fire_at_utc).toBe('2026-10-11T13:00:00.000Z');
  await h.services.plans.revise(
    { ...h.ctx, idempotency_key: 'rev' },
    p.id,
    p.version,
    { days: [{ ...p.days[0], local_date: '2026-10-13' }] },
  );
  const after = await h.services.reminders.list('personal');
  expect(after).toHaveLength(1);
  expect(after[0].workout_day_id).toBe(before[0].workout_day_id);
  expect(after[0].fire_at_utc).toBe('2026-10-12T13:00:00.000Z');
});
it('cancel_removes_reminder', async () => {
  await setup();
  const p = await active();
  await h.services.plans.cancel(
    { ...h.ctx, idempotency_key: 'x' },
    p.id,
    p.version,
  );
  expect(await h.services.reminders.list('personal')).toEqual([]);
  expect(h.services.plans.getDay('personal', p.days[0].id).status).toBe(
    'cancelled',
  );
});
it('late_confirm_has_no_past_notification', async () => {
  await setup(() => new Date('2026-10-11T14:00:00Z'));
  await active();
  expect(await h.services.reminders.list('personal')).toEqual([]);
});
it('timezone_recomputes_future_reminders', async () => {
  await setup();
  await active();
  await h.services.profile.update(
    { ...h.ctx, idempotency_key: 'tz' },
    { expected_version: 0, timezone: 'America/Los_Angeles' },
  );
  expect((await h.services.reminders.list('personal'))[0].fire_at_utc).toBe(
    '2026-10-12T04:00:00.000Z',
  );
});
