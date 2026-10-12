import { expect, it } from 'vitest';
import { LocalCore } from '../src/local/core';

const goal = (
  from = '2026-11-01',
  to: string | null = null,
  calories = 2300,
) => ({
  effective_from: from,
  effective_to: to,
  allow_history: true,
  water_ml: 2100,
  calories_kcal: calories,
  carbs_g: 250,
  protein_g: 120,
  fat_g: 60,
});
const exercise = (name = '卧推', load = 30) => ({
  exercise_id: name,
  name,
  variant: '标准',
  equipment: 'barbell',
  load_convention: 'total',
  weight_kg: load,
  increment_kg: 2.5,
  sets: 3,
  reps_min: 8,
  reps_max: 12,
  rest_seconds: 90,
});
const dated = () => ({
  name: '两次训练',
  days: [
    { local_date: '2026-11-03', name: '推', exercises: [exercise()] },
    { local_date: '2026-11-08', name: '拉', exercises: [exercise('划船')] },
  ],
});
function platform() {
  const values = new Map<string, any>();
  return {
    getStorageSync: (key: string) => values.get(key) ?? '',
    setStorageSync: (key: string, value: any) => values.set(key, value),
    removeStorageSync: (key: string) => values.delete(key),
  };
}

it('local confirmations use the same captured-date schema, stay durable and remain compatible with backups', async () => {
  const phone = platform();
  let now = new Date('2026-10-11T15:59:58Z');
  const core = new LocalCore(phone, () => now);
  const target = await core.request(
    'POST',
    '/targets/drafts',
    goal(),
    'target',
  );
  const plan = await core.request('POST', '/plans/drafts', dated(), 'plan');
  const payload = { expected_version: 1, apply_from: '2026-10-11' };
  const activeTarget = await core.request(
    'POST',
    `/targets/${target.id}/confirm`,
    payload,
    'target-confirm',
  );
  const activePlan = await core.request(
    'POST',
    `/plans/${plan.id}/confirm`,
    payload,
    'plan-confirm',
  );
  expect(activeTarget.effective_from).toBe('2026-10-11');
  expect(activePlan.days[0].local_date).toBe('2026-10-11');
  now = new Date('2026-10-11T16:00:02Z');
  const restarted = new LocalCore(phone, () => now);
  expect(
    await restarted.request(
      'POST',
      `/plans/${plan.id}/confirm`,
      payload,
      'plan-confirm',
    ),
  ).toEqual(activePlan);
  await expect(
    restarted.request(
      'POST',
      `/plans/${plan.id}/cancel`,
      payload,
      'cancel-with-date',
    ),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  const backup = restarted.exportBackup();
  const restored = new LocalCore(platform(), () => now);
  restored.importBackup(backup);
  expect(restored.services.plans.get('personal', plan.id)).toEqual(activePlan);
  expect(restored.services.targets.forDate('personal', '2026-10-11')).toEqual(
    activeTarget,
  );
});

it('retains every occurrence of a one-year cycle when confirmation extends its final date by six days, including backup restore', async () => {
  const core = new LocalCore(
    platform(),
    () => new Date('2026-10-11T15:59:58Z'),
  );
  const draft = await core.request(
    'POST',
    '/plans/drafts',
    {
      name: '全年周一训练',
      repeat: {
        start_date: '2026-10-12',
        end_date: '2027-10-11',
        weekdays: [1],
        name: '推',
        exercises: [exercise()],
      },
    },
    'year-draft',
  );
  const active = await core.request(
    'POST',
    `/plans/${draft.id}/confirm`,
    { expected_version: 1, apply_from: '2026-10-13' },
    'year-confirm',
  );
  expect(active.period).toEqual({
    start_date: '2026-10-13',
    end_date: '2027-10-18',
  });
  expect(active.days).toHaveLength(draft.days.length);
  expect(active.days.map((day: any) => day.id)).toEqual(
    draft.days.map((day: any) => day.id),
  );
  expect(
    active.days.every((day: any) => new Date(day.local_date).getUTCDay() === 1),
  ).toBe(true);
  expect(active.days.at(-1).local_date).toBe(active.period.end_date);
  const restored = new LocalCore(platform());
  restored.importBackup(core.exportBackup());
  expect(restored.services.plans.get('personal', draft.id)).toEqual(active);
});

it('keeps multiple sessions on the same original cycle date together when applying and restoring a plan', async () => {
  const core = new LocalCore(platform());
  const draft = await core.request(
    'POST',
    '/plans/drafts',
    {
      name: '每周双练',
      repeat: {
        start_date: '2026-10-12',
        end_date: '2026-10-25',
        weekdays: [1],
        name: '早课',
        exercises: [exercise()],
      },
    },
    'draft',
  );
  const originalDays = draft.days.map(
    ({ id, local_date, name, exercises }: any) => ({
      id,
      local_date,
      name,
      exercises,
    }),
  );
  const revised = await core.request(
    'PATCH',
    `/plans/${draft.id}`,
    {
      expected_version: 1,
      patch: {
        days: [
          ...originalDays,
          {
            local_date: '2026-10-12',
            name: '晚课',
            exercises: [exercise('划船', 20)],
          },
        ],
      },
    },
    'evening',
  );
  const active = await core.request(
    'POST',
    `/plans/${draft.id}/confirm`,
    { expected_version: revised.version, apply_from: '2026-10-13' },
    'confirm',
  );
  expect(active.period).toEqual({
    start_date: '2026-10-13',
    end_date: '2026-10-26',
  });
  expect(
    active.days.map((day: any) => [
      day.local_date,
      day.name,
      day.exercises[0].weight_kg,
    ]),
  ).toEqual([
    ['2026-10-19', '早课', 30],
    ['2026-10-19', '晚课', 20],
    ['2026-10-26', '早课', 30],
  ]);
  expect(active.days.map((day: any) => day.id).sort()).toEqual(
    revised.days.map((day: any) => day.id).sort(),
  );
  const restored = new LocalCore(platform());
  restored.importBackup(core.exportBackup());
  expect(restored.services.plans.get('personal', draft.id)).toEqual(active);
});
