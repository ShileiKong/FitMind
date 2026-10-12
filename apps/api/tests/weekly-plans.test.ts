import { afterEach, expect, it } from 'vitest';
import { makeHarness } from './helpers.js';
import { executeTool } from '../src/modules/agent/tools.js';
let h: any;
afterEach(async () => {
  if (h) await h.close();
  h = null;
});
const exercise = (name: string) => ({
  exercise_id: name,
  name,
  variant: '标准',
  equipment: 'barbell',
  load_convention: 'total',
  weight_kg: 30,
  increment_kg: 2.5,
  sets: 3,
  reps_min: 8,
  reps_max: 12,
  rest_seconds: 90,
});
const input = () => ({
  name: '三分化周循环',
  weekly: {
    start_date: '2026-10-12',
    end_date: '2026-10-25',
    days: [
      { weekday: 4, name: '推', exercises: [exercise('卧推')] },
      { weekday: 5, name: '拉', exercises: [exercise('划船')] },
      { weekday: 6, name: '腿', exercises: [exercise('深蹲')] },
    ],
  },
});
it('accepts different weekday templates over an inclusive period through the public API', async () => {
  h = await makeHarness();
  const response = await h.app.inject({
    method: 'POST',
    url: '/api/v1/plans/drafts',
    headers: {
      authorization: 'Bearer test-token',
      'idempotency-key': 'weekly-http',
    },
    payload: input(),
  });
  expect(response.statusCode).toBe(200);
  const p = response.json().data;
  expect(p.period).toEqual({
    start_date: '2026-10-12',
    end_date: '2026-10-25',
  });
  expect(
    p.days.map((d: any) => [d.local_date, d.name, d.exercises[0].name]),
  ).toEqual([
    ['2026-10-15', '推', '卧推'],
    ['2026-10-16', '拉', '划船'],
    ['2026-10-17', '腿', '深蹲'],
    ['2026-10-22', '推', '卧推'],
    ['2026-10-23', '拉', '划船'],
    ['2026-10-24', '腿', '深蹲'],
  ]);
  expect(new Set(p.days.map((d: any) => d.id)).size).toBe(6);
  expect(p.status).toBe('draft');
});
it('the agent saves one weekly draft and confirmation still schedules every actual training day', async () => {
  h = await makeHarness();
  const p = await executeTool(
    h.app,
    h.ctx,
    { message_id: 'message', text: '安排三分化周循环' } as any,
    'draft_plan',
    { input: input() },
  );
  expect(await h.services.reminders.list('personal')).toEqual([]);
  const active = await h.services.plans.confirm(
    { ...h.ctx, idempotency_key: 'confirm' },
    p.id,
    p.version,
  );
  const reminders = await h.services.reminders.list('personal');
  expect(reminders.map((r: any) => r.training_date)).toEqual([
    '2026-10-15',
    '2026-10-16',
    '2026-10-17',
    '2026-10-22',
    '2026-10-23',
    '2026-10-24',
  ]);
  expect(reminders[0].fire_at_utc).toBe('2026-10-14T13:00:00.000Z');
  expect(active.days.every((d: any) => d.status === 'active')).toBe(true);
});
it.each(['days', 'repeat'] as const)(
  'cannot silently ignore %s combined with weekly templates',
  async (mode) => {
    h = await makeHarness();
    const mixed: any = input();
    mixed[mode] =
      mode === 'days'
        ? [
            {
              local_date: '2026-10-15',
              name: 'A',
              exercises: [exercise('卧推')],
            },
          ]
        : {
            start_date: '2026-10-12',
            end_date: '2026-10-25',
            weekdays: [4],
            name: 'A',
            exercises: [exercise('卧推')],
          };
    await expect(
      h.services.plans.createDraft(h.ctx, mixed),
    ).rejects.toMatchObject({ code: 'INVALID_PLAN' });
    expect(h.services.plans.list('personal')).toEqual([]);
  },
);
it('rejects duplicate weekdays instead of generating two conflicting daily prescriptions', async () => {
  h = await makeHarness();
  const p = input();
  p.weekly.days[1].weekday = 4;
  await expect(h.services.plans.createDraft(h.ctx, p)).rejects.toMatchObject({
    code: 'DUPLICATE_WEEKDAY',
  });
});
it('a weekly revision preserves matching training day IDs and replaces the prescription', async () => {
  h = await makeHarness();
  const p = await h.services.plans.createDraft(h.ctx, input());
  const patch = input();
  patch.weekly.days[0].exercises[0].weight_kg = 32.5;
  const response = await h.app.inject({
    method: 'PATCH',
    url: '/api/v1/plans/' + p.id,
    headers: {
      authorization: 'Bearer test-token',
      'idempotency-key': 'weekly-patch',
    },
    payload: { expected_version: p.version, patch: { weekly: patch.weekly } },
  });
  expect(response.statusCode).toBe(200);
  const revised = response.json().data;
  expect(revised.days.map((d: any) => d.id)).toEqual(
    p.days.map((d: any) => d.id),
  );
  expect(revised.days[0].exercises[0].weight_kg).toBe(32.5);
  expect(revised.days[3].exercises[0].weight_kg).toBe(32.5);
  expect(revised.version).toBe(2);
});
it('keeps the planned period when changing a weight but adjusts it for an outside date', async () => {
  h = await makeHarness();
  const p = await h.services.plans.createDraft(h.ctx, input());
  const weight = await h.services.plans.revise(
    { ...h.ctx, idempotency_key: 'weight' },
    p.id,
    p.version,
    {
      days: p.days.map((d: any) => ({
        ...d,
        exercises: d.exercises.map((e: any) => ({ ...e, weight_kg: 35 })),
      })),
    },
  );
  expect(weight.period).toEqual({
    start_date: '2026-10-12',
    end_date: '2026-10-25',
  });
  const moved = await h.services.plans.revise(
    { ...h.ctx, idempotency_key: 'date' },
    weight.id,
    weight.version,
    {
      days: weight.days.map((d: any, i: number) =>
        i === 5 ? { ...d, local_date: '2026-10-26' } : d,
      ),
    },
  );
  expect(moved.period).toEqual({
    start_date: '2026-10-15',
    end_date: '2026-10-26',
  });
});
