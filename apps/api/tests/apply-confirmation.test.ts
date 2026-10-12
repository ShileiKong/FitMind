import { afterEach, expect, it } from 'vitest';
import { makeHarness } from './helpers.js';

let h: any;
afterEach(async () => {
  if (h) await h.close();
  h = null;
});
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
const weekly = () => ({
  name: '两周分化',
  weekly: {
    start_date: '2026-10-12',
    end_date: '2026-10-25',
    days: [1, 3, 5].map((weekday, index) => ({
      weekday,
      name: ['推', '拉', '腿'][index],
      exercises: [exercise(['卧推', '划船', '深蹲'][index], 30 + index * 10)],
    })),
  },
});
const command = (key: string, date = '2026-10-11') => ({
  ...h.ctx,
  idempotency_key: key,
  reference_local_date: date,
});
const headers = (key: string) => ({
  authorization: 'Bearer test-token',
  'idempotency-key': key,
});
it('applies finite target drafts from the captured date while preserving historical and subsequent target coverage', async () => {
  h = await makeHarness();
  const old = await h.services.targets.draft(
    command('old-draft'),
    goal('2026-10-01', null, 2000),
  );
  await h.services.targets.confirm(command('old-confirm'), old.id, 1);
  const draft = await h.services.targets.draft(
    command('draft'),
    goal('2026-11-01', '2026-11-05'),
  );
  const active = await h.services.targets.confirm(
    command('confirm'),
    draft.id,
    1,
    '2026-10-11',
  );
  expect(active).toMatchObject({
    status: 'active',
    version: 2,
    effective_from: '2026-10-11',
    effective_to: '2026-10-15',
  });
  expect(h.services.targets.forDate('personal', '2026-10-10')).toMatchObject({
    id: old.id,
    calories_kcal: 2000,
  });
  expect(
    h.services.targets.forDate('personal', '2026-10-11').calories_kcal,
  ).toBe(2300);
  expect(
    h.services.targets.forDate('personal', '2026-10-15').calories_kcal,
  ).toBe(2300);
  expect(
    h.services.targets.forDate('personal', '2026-10-16').calories_kcal,
  ).toBe(2000);
});

it('keeps an explicitly chosen confirmation date on target retries after midnight and rejects changed dates with the same key', async () => {
  h = await makeHarness();
  const draft = await h.services.targets.draft(command('draft'), goal());
  const first = await h.services.targets.confirm(
    command('confirm'),
    draft.id,
    1,
    '2026-10-11',
  );
  await h.reopen();
  const retried = await h.services.targets.confirm(
    command('confirm', '2026-10-12'),
    draft.id,
    1,
    '2026-10-11',
  );
  expect(retried).toEqual(first);
  expect(retried.effective_from).toBe('2026-10-11');
  expect(h.services.targets.list('personal')).toHaveLength(1);
  await expect(
    h.services.targets.confirm(
      command('confirm', '2026-10-12'),
      draft.id,
      1,
      '2026-10-12',
    ),
  ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
});

it('shifts dated plans from their first day while preserving gaps, identities and all prescriptions', async () => {
  h = await makeHarness();
  const draft = await h.services.plans.createDraft(command('draft'), dated());
  const active = await h.services.plans.confirm(
    command('confirm'),
    draft.id,
    1,
    '2026-10-11',
  );
  expect(active.days.map((day: any) => day.local_date)).toEqual([
    '2026-10-11',
    '2026-10-16',
  ]);
  expect(active.days.map((day: any) => day.id)).toEqual(
    draft.days.map((day: any) => day.id),
  );
  expect(active.days.map((day: any) => day.exercises)).toEqual(
    draft.days.map((day: any) => day.exercises),
  );
  expect(
    active.days.every(
      (day: any) => day.status === 'active' && day.plan_version === 2,
    ),
  ).toBe(true);
  expect(active.period).toBeUndefined();
});

it('keeps plan confirmation receipts durable and rejects a different start date for the same command', async () => {
  h = await makeHarness();
  const draft = await h.services.plans.createDraft(command('draft'), dated());
  const first = await h.services.plans.confirm(
    command('confirm'),
    draft.id,
    1,
    '2026-10-11',
  );
  await h.reopen();
  expect(
    await h.services.plans.confirm(
      command('confirm', '2026-10-12'),
      draft.id,
      1,
      '2026-10-11',
    ),
  ).toEqual(first);
  await expect(
    h.services.plans.confirm(
      command('confirm', '2026-10-12'),
      draft.id,
      1,
      '2026-10-12',
    ),
  ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  expect(h.services.plans.get('personal', draft.id)).toEqual(first);
});

it('bounds an open-ended replacement by the next scheduled target without changing prior or later coverage', async () => {
  h = await makeHarness();
  const old = await h.services.targets.draft(
    command('old'),
    goal('2026-10-01', null, 2000),
  );
  await h.services.targets.confirm(command('old-confirm'), old.id, 1);
  const next = await h.services.targets.draft(
    command('next'),
    goal('2026-10-20', null, 2400),
  );
  const scheduled = await h.services.targets.confirm(
    command('next-confirm'),
    next.id,
    1,
  );
  const draft = await h.services.targets.draft(command('draft'), goal());
  const active = await h.services.targets.confirm(
    command('confirm'),
    draft.id,
    1,
    '2026-10-11',
  );
  expect(active.effective_to).toBe('2026-10-19');
  expect(h.services.targets.forDate('personal', '2026-10-10')).toMatchObject({
    id: old.id,
    calories_kcal: 2000,
  });
  expect(h.services.targets.forDate('personal', '2026-10-19').id).toBe(
    active.id,
  );
  expect(h.services.targets.forDate('personal', '2026-10-20')).toEqual(
    scheduled,
  );
});

it('maps each weekday sequence independently and preserves week-specific weight progression', async () => {
  h = await makeHarness();
  const draft = await h.services.plans.createDraft(command('draft'), weekly());
  const progressed = await h.services.plans.revise(
    command('progression'),
    draft.id,
    1,
    {
      days: draft.days.map((day: any, index: number) => ({
        ...day,
        exercises: day.exercises.map((item: any) => ({
          ...item,
          weight_kg: item.weight_kg + (index >= 3 ? 2.5 : 0),
        })),
      })),
    },
  );
  const active = await h.services.plans.confirm(
    command('confirm', '2026-10-13'),
    draft.id,
    progressed.version,
    '2026-10-13',
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
    ['2026-10-14', '拉', 40],
    ['2026-10-16', '腿', 50],
    ['2026-10-19', '推', 30],
    ['2026-10-21', '拉', 42.5],
    ['2026-10-23', '腿', 52.5],
    ['2026-10-26', '推', 32.5],
  ]);
  expect(active.days.map((day: any) => day.id).sort()).toEqual(
    draft.days.map((day: any) => day.id).sort(),
  );
  expect(active.days.every((day: any) => day.local_date >= '2026-10-13')).toBe(
    true,
  );
});

it.each([
  {
    name: 'middle rest week',
    omit: '2026-10-19',
    apply: '2026-10-12',
    dates: ['2026-10-12', '2026-10-26'],
    loads: [30, 35],
  },
  {
    name: 'skipped first week',
    omit: '2026-10-12',
    apply: '2026-10-13',
    dates: ['2026-10-26', '2026-11-02'],
    loads: [32.5, 35],
  },
])(
  'preserves a $name when applying a revised cycle instead of closing the gap',
  async ({ omit, apply, dates, loads }) => {
    h = await makeHarness();
    const draft = await h.services.plans.createDraft(command('draft'), {
      name: '含休息周的循环',
      repeat: {
        start_date: '2026-10-12',
        end_date: '2026-11-01',
        weekdays: [1],
        name: '推',
        exercises: [exercise()],
      },
    });
    const revised = await h.services.plans.revise(
      command('revise'),
      draft.id,
      1,
      {
        days: draft.days
          .map((day: any, index: number) => ({
            ...day,
            exercises: day.exercises.map((item: any) => ({
              ...item,
              weight_kg: 30 + index * 2.5,
            })),
          }))
          .filter((day: any) => day.local_date !== omit),
      },
    );
    const active = await h.services.plans.confirm(
      command('confirm', apply),
      draft.id,
      revised.version,
      apply,
    );
    expect(active.days.map((day: any) => day.local_date)).toEqual(dates);
    expect(active.days.map((day: any) => day.exercises[0].weight_kg)).toEqual(
      loads,
    );
    expect(active.days.map((day: any) => day.id)).toEqual(
      revised.days.map((day: any) => day.id),
    );
    expect(
      h.services.plans.getDay(
        'personal',
        draft.days.find((day: any) => day.local_date === omit).id,
      ).status,
    ).toBe('cancelled');
  },
);

it('enables a cycle on a rest day, retains its full duration and does not cancel other plans or actual sessions', async () => {
  h = await makeHarness();
  const existing = await h.services.plans.createDraft(
    command('existing-draft'),
    {
      name: '旧计划',
      days: [
        { local_date: '2026-10-10', name: '旧训练', exercises: [exercise()] },
      ],
    },
  );
  const old = await h.services.plans.confirm(
    command('existing-confirm'),
    existing.id,
    1,
  );
  const session = await h.services.workouts.start(
    command('start'),
    old.days[0].id,
  );
  const draft = await h.services.plans.createDraft(command('draft'), weekly());
  const active = await h.services.plans.confirm(
    command('confirm'),
    draft.id,
    1,
    '2026-10-11',
  );
  expect(active.status).toBe('active');
  expect(active.period).toEqual({
    start_date: '2026-10-11',
    end_date: '2026-10-24',
  });
  expect(active.days[0].local_date).toBe('2026-10-12');
  expect(h.services.plans.get('personal', old.id)).toEqual(old);
  expect(h.services.workouts.get('personal', session.id)).toEqual(session);
  await expect(
    h.services.plans.confirm(
      command('reapply'),
      active.id,
      active.version,
      '2026-10-12',
    ),
  ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  expect(h.services.plans.get('personal', active.id)).toEqual(active);
});

it('preserves the original scheduled dates for legacy three-argument confirmation and checks stale versions', async () => {
  h = await makeHarness();
  const target = await h.services.targets.draft(command('target'), goal());
  const plan = await h.services.plans.createDraft(command('plan'), dated());
  await expect(
    h.services.targets.confirm(
      command('bad-target-version'),
      target.id,
      99,
      '2026-10-11',
    ),
  ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  await expect(
    h.services.plans.confirm(
      command('bad-plan-version'),
      plan.id,
      99,
      '2026-10-11',
    ),
  ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  expect(
    (await h.services.targets.confirm(command('target-confirm'), target.id, 1))
      .effective_from,
  ).toBe('2026-11-01');
  expect(
    (
      await h.services.plans.confirm(command('plan-confirm'), plan.id, 1)
    ).days.map((day: any) => day.local_date),
  ).toEqual(['2026-11-03', '2026-11-08']);
});

it.each(['targets', 'plans'])(
  'public %s confirmation accepts apply_from and keeps it fixed on a later-day retry',
  async (kind) => {
    let now = new Date('2026-10-11T15:59:58Z');
    h = await makeHarness({ clock: () => now });
    const draft =
      kind === 'targets'
        ? await h.services.targets.draft(command('draft'), goal())
        : await h.services.plans.createDraft(command('draft'), dated());
    const options: any = {
      method: 'POST',
      url: `/api/v1/${kind}/${draft.id}/confirm`,
      headers: headers('http-confirm'),
      payload: { expected_version: 1, apply_from: '2026-10-11' },
    };
    const first = await h.app.inject(options);
    expect(first.statusCode).toBe(200);
    const data = first.json().data;
    expect(
      kind === 'targets' ? data.effective_from : data.days[0].local_date,
    ).toBe('2026-10-11');
    now = new Date('2026-10-11T16:00:02Z');
    const retry = await h.app.inject(options);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().data).toEqual(data);
  },
);

it.each(['targets', 'plans'])(
  'rejects malformed and impossible %s confirmation dates without activating or shifting the draft',
  async (kind) => {
    h = await makeHarness();
    const draft =
      kind === 'targets'
        ? await h.services.targets.draft(command('draft'), goal())
        : await h.services.plans.createDraft(command('draft'), dated());
    for (const apply_from of ['2026-2-3', '2026-02-30', '']) {
      const response = await h.app.inject({
        method: 'POST',
        url: `/api/v1/${kind}/${draft.id}/confirm`,
        headers: headers('invalid-' + apply_from),
        payload: { expected_version: 1, apply_from },
      });
      expect(response.statusCode).toBe(400);
    }
    expect(
      kind === 'targets'
        ? h.services.targets.list('personal')[0]
        : h.services.plans.get('personal', draft.id),
    ).toEqual(draft);
  },
);
