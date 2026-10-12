import { it, expect, afterEach } from 'vitest';
import { makeHarness } from './helpers.js';
import { executeTool, agentTools } from '../src/modules/agent/tools.js';
import { recommendNextWorkout } from '../src/modules/workouts/recommendation.js';
let h: any;
afterEach(async () => {
  if (h) await h.close();
  h = null;
});
const auth = {
  authorization: 'Bearer test-token',
  'idempotency-key': 'profile-empty',
};
const p: any = {
  exercise_id: 'bench',
  name: '卧推',
  variant: '杠铃平板',
  equipment: 'barbell',
  load_convention: 'total',
  weight_kg: 100,
  increment_kg: 2.5,
  sets: 1,
  reps_min: 8,
  reps_max: 12,
  rest_seconds: 90,
};
const unique = (key: string) => ({ ...h.ctx, idempotency_key: key });
async function plan(ids = ['bench', 'bench', 'bench', 'bench']) {
  const draft = await h.services.plans.createDraft(unique('plan'), {
    name: 'A',
    days: ids.map((id, i) => ({
      name: 'A',
      local_date: `2026-10-${String(8 + i * 2).padStart(2, '0')}`,
      exercises: [{ ...p, exercise_id: id }],
    })),
  });
  return h.services.plans.confirm(
    unique('confirm-plan'),
    draft.id,
    draft.version,
  );
}
async function complete(day: any, n: number, reps = 12, difficulty = 'easy') {
  const ctx = {
    ...unique('start-' + n),
    now_utc: `2026-10-${String(8 + n * 2).padStart(2, '0')}T02:00:00Z`,
  };
  let w = await h.services.workouts.start(ctx, day.id);
  const saved = await h.services.workouts.recordSet(
    { ...ctx, idempotency_key: 'set-' + n },
    w.id,
    {
      exercise_id: day.exercises[0].exercise_id,
      weight_kg: 100,
      reps,
      difficulty,
      rpe: null,
      pain: false,
    },
  );
  return h.services.workouts.transition(
    { ...ctx, idempotency_key: 'finish-' + n },
    w.id,
    saved.session.version,
    { action: 'complete' },
  );
}
it('profile rejects blank timezone and recovers previously corrupt settings', async () => {
  h = await makeHarness();
  const r = await h.app.inject({
    method: 'PATCH',
    url: '/api/v1/profile',
    headers: auth,
    payload: { expected_version: 0, timezone: '' },
  });
  expect(r.statusCode).toBe(400);
  h.app.store.put('personal', 'profile', {
    ...h.services.profile.get('personal'),
    timezone: '',
    version: 1,
  });
  const repair = await h.app.inject({
    method: 'PATCH',
    url: '/api/v1/profile',
    headers: { ...auth, 'idempotency-key': 'repair' },
    payload: { expected_version: 1, timezone: 'Asia/Shanghai' },
  });
  expect(repair.statusCode).toBe(200);
  expect(
    (await h.app.inject({ url: '/api/v1/context', headers: auth })).json().data
      .local_date,
  ).toBe('2026-10-11');
});
it('profile rejects a stale full settings snapshot', async () => {
  h = await makeHarness();
  await h.services.profile.update(unique('tokyo'), {
    expected_version: 0,
    timezone: 'Asia/Tokyo',
  });
  await expect(
    h.services.profile.update(unique('stale'), {
      expected_version: 0,
      timezone: 'Asia/Shanghai',
      reminder_time: '20:00',
    }),
  ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  expect(h.services.profile.get('personal').timezone).toBe('Asia/Tokyo');
});
it('bounded target correction preserves both earlier and later intervals', async () => {
  h = await makeHarness();
  const make = async (from: string, to: string | null, calories: number) => {
    const d = await h.services.targets.draft(unique('d' + from + calories), {
      effective_from: from,
      effective_to: to,
      allow_history: true,
      calories_kcal: calories,
      water_ml: 2000,
      carbs_g: 200,
      protein_g: 120,
      fat_g: 60,
    });
    await h.services.targets.confirm(
      unique('c' + from + calories),
      d.id,
      d.version,
    );
  };
  await make('2026-10-01', null, 2000);
  await make('2026-10-10', null, 2200);
  await make('2026-10-05', '2026-10-05', 1800);
  expect(
    ['04', '05', '06', '09', '10', '11'].map(
      (d) =>
        h.services.targets.forDate('personal', '2026-10-' + d)?.calories_kcal,
    ),
  ).toEqual([2000, 1800, 2000, 2000, 2200, 2200]);
  await make('2026-10-06', '2026-10-10', 1900);
  expect(
    h.services.targets.forDate('personal', '2026-10-11').calories_kcal,
  ).toBe(2200);
});
it('new failed performance invalidates an older future load proposal', async () => {
  h = await makeHarness();
  const a = await plan();
  await complete(a.days[0], 0);
  const second = await complete(a.days[1], 1);
  const old = h.services.workouts
    .recommendations('personal', second.id)
    .find((r: any) => r.type === 'next_workout');
  expect(old.weight_kg).toBe(102.5);
  await complete(a.days[2], 2, 3, 'hard');
  await expect(
    h.services.workouts.acceptRecommendation(
      unique('accept-stale'),
      old.id,
      old.version,
    ),
  ).rejects.toMatchObject({ code: 'STALE_RECOMMENDATION' });
  expect(
    h.services.plans.get('personal', a.id).days[3].exercises[0].weight_kg,
  ).toBe(100);
});
it('future plan revision invalidates a proposal based on its earlier load', async () => {
  h = await makeHarness();
  const a = await plan();
  await complete(a.days[0], 0);
  const w = await complete(a.days[1], 1);
  const old = h.services.workouts
    .recommendations('personal', w.id)
    .find((r: any) => r.type === 'next_workout');
  h.services.plans.revise(unique('change-plan'), a.id, a.version, {
    days: a.days.map((d: any) => ({
      ...d,
      exercises: d.exercises.map((e: any) => ({ ...e, weight_kg: 90 })),
    })),
  });
  await expect(
    h.services.workouts.acceptRecommendation(
      unique('accept'),
      old.id,
      old.version,
    ),
  ).rejects.toMatchObject({ code: 'STALE_RECOMMENDATION' });
});
it('same movement from manual random slot IDs shares comparable history', async () => {
  h = await makeHarness();
  const a = await plan(['random-a', 'random-b', 'random-c', 'random-d']);
  await complete(a.days[0], 0);
  const w = await complete(a.days[1], 1);
  const rec = h.services.workouts
    .recommendations('personal', w.id)
    .find((r: any) => r.type === 'next_workout');
  expect(rec?.weight_kg).toBe(102.5);
  expect(
    (
      await h.services.trends.query('personal', {
        metric: 'workout',
        exercise_id: 'random-b',
      })
    ).points,
  ).toHaveLength(2);
  await h.services.workouts.acceptRecommendation(
    unique('accept-movement'),
    rec.id,
    rec.version,
  );
  expect(
    h.services.plans.get('personal', a.id).days[3].exercises[0].weight_kg,
  ).toBe(102.5);
});
it('hard feedback cannot become a successful workout from a conflicting low RPE', () => {
  const history = [1, 2].map((n) => ({
    session_id: 'w' + n,
    prescription: p,
    sets: [
      {
        id: 's' + n,
        version: 1,
        weight_kg: 100,
        reps: 12,
        difficulty: 'hard',
        rpe: 6,
        pain: false,
      },
    ],
  }));
  expect(recommendNextWorkout(history, p).reason_code).toBe(
    'NEED_TWO_SUCCESSES',
  );
});
it('recovering an older ambiguous correction freezes its original conversation and facts', async () => {
  const requests: any[] = [];
  let fail = false;
  h = await makeHarness({
    providers: {
      text: {
        next: async (req: any) => {
          requests.push(req);
          if (fail) throw new Error('network');
          return { assistant_text: 'ok', tool_calls: [] };
        },
      },
    },
  });
  await h.services.records.create(unique('water300'), {
    kind: 'water',
    amount_ml: 300,
  });
  await h.services.agent.submit(h.ctx, {
    message_id: 'first',
    conversation_id: 'main',
    text: '喝了300ml',
  });
  fail = true;
  await h.services.agent.submit(h.ctx, {
    message_id: 'correction',
    conversation_id: 'main',
    text: '那杯其实200ml',
  });
  const original = requests.at(-1);
  fail = false;
  await h.services.records.create(unique('water500'), {
    kind: 'water',
    amount_ml: 500,
  });
  await h.services.agent.submit(h.ctx, {
    message_id: 'later',
    conversation_id: 'main',
    text: '刚又喝了500ml',
  });
  await h.reopen();
  await h.services.agent.recover(h.ctx, 'correction');
  expect(requests.at(-1).transcript).toEqual(original.transcript);
  expect(requests.at(-1).instructions).toBe(original.instructions);
});
it('explicit ongoing preferences do not require magic remember words', async () => {
  h = await makeHarness();
  const value = '我只喜欢晚上训练，以后都安排在晚上';
  const saved: any = await executeTool(
    h.app,
    unique('remember'),
    { message_id: 'preference', text: value },
    'remember',
    { key: 'training_time', value },
  );
  expect(saved.value).toBe(value);
  await expect(
    executeTool(
      h.app,
      unique('invented'),
      { message_id: 'unrelated', text: '喝了水' },
      'remember',
      { key: 'training_time', value },
    ),
  ).rejects.toMatchObject({ code: 'MEMORY_SOURCE_REQUIRED' });
});
it('AI can revise plans and settings, control a workout, and revise memory through versioned services', async () => {
  h = await makeHarness();
  const a = await plan();
  const request = {
    message_id: 'ops',
    text: '把训练改到明天，提醒改为20:00，开始训练；膝盖疼，暂停训练；更正偏好为晚上',
  };
  expect(agentTools.map((t) => t.name)).toEqual(
    expect.arrayContaining([
      'revise_plan',
      'cancel_plan',
      'update_profile',
      'start_workout',
      'transition_workout',
      'accept_recommendation',
      'revise_memory',
    ]),
  );
  const invoke = (name: string, args: any) =>
    executeTool(h.app, unique(name), request, name, args);
  const revised: any = await invoke('revise_plan', {
    id: a.id,
    expected_version: a.version,
    patch_json: JSON.stringify({
      days: a.days.map((d: any, i: number) => ({
        ...d,
        local_date: i === 3 ? '2026-10-15' : d.local_date,
      })),
    }),
  });
  expect(revised.version).toBe(a.version + 1);
  const profile: any = await invoke('update_profile', {
    expected_version: 0,
    patch_json: JSON.stringify({ reminder_time: '20:00' }),
  });
  expect(profile.reminder_time).toBe('20:00');
  const w: any = await invoke('start_workout', {
    workout_day_id: revised.days[0].id,
  });
  const paused: any = await invoke('transition_workout', {
    session_id: w.id,
    expected_version: w.version,
    action: 'pause',
    exercise_id: null,
    local_date: null,
  });
  expect(paused.status).toBe('paused');
  expect(paused.sets).toHaveLength(0);
  const memory = await h.services.memory.remember(unique('memory'), {
    key: 'preference',
    value: '上午',
    source_message_id: 'm',
  });
  expect(
    (
      await invoke('revise_memory', {
        id: memory.id,
        expected_version: memory.version,
        value: '晚上',
      })
    ).value,
  ).toBe('晚上');
});
it('a chat can start a workout then record its first set without losing the new session binding', async () => {
  let dayId = '';
  let turn = 0;
  h = await makeHarness({
    providers: {
      text: {
        next: async () =>
          turn++ === 0
            ? {
                tool_calls: [
                  {
                    name: 'start_workout',
                    call_id: 'start',
                    arguments: { workout_day_id: dayId },
                  },
                  {
                    name: 'record_set',
                    call_id: 'set',
                    arguments: {
                      session_id: null,
                      exercise_id: null,
                      weight_kg: 100,
                      reps: 12,
                      difficulty: 'easy',
                      rpe: 6,
                      pain: false,
                      reduce: false,
                    },
                  },
                ],
              }
            : { assistant_text: '已记录', tool_calls: [] },
      },
    },
  });
  const a = await plan();
  dayId = a.days[0].id;
  const result = await h.services.agent.submit(h.ctx, {
    message_id: 'start-and-set',
    conversation_id: 'main',
    text: '开始卧推，第一组100公斤12次，轻松',
    workout_session_id: null,
  });
  expect(result.tool_errors).toHaveLength(0);
  expect(h.services.workouts.list('personal')[0].sets).toHaveLength(1);
});
