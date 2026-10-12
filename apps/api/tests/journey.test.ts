import { it, expect } from 'vitest';
import { makeHarness } from './helpers.js';
import { randomUUID } from 'node:crypto';
const exercise = {
  exercise_id: 'bench',
  name: '卧推',
  variant: '杠铃平板',
  equipment: 'barbell',
  load_convention: 'total',
  weight_kg: 100,
  increment_kg: 2.5,
  sets: 3,
  reps_min: 10,
  reps_max: 12,
  rest_seconds: 90,
};
it('full_personal_journey', async () => {
  let now = new Date('2026-10-11T02:00:00Z');
  const h = await makeHarness({ clock: () => now });
  const call = async (
    method: string,
    path: string,
    body?: any,
    key = randomUUID(),
  ) => {
    const r = await h.app.inject({
      method: method as any,
      url: '/api/v1' + path,
      headers: { authorization: 'Bearer test-token', 'idempotency-key': key },
      payload: body,
    });
    expect(r.statusCode, r.body).toBe(200);
    return r.json().data;
  };
  try {
    expect((await call('GET', '/records')).items).toHaveLength(0);
    expect(await call('GET', '/plans')).toEqual([]);
    const target = await call('POST', '/targets/drafts', {
      effective_from: '2026-10-11',
      water_ml: 2000,
      calories_kcal: 2000,
      carbs_g: 250,
      protein_g: 150,
      fat_g: 60,
    });
    await call('POST', '/targets/drafts/' + target.id + '/confirm', {
      expected_version: target.version,
    });
    const water = await call('POST', '/records', {
      kind: 'water',
      amount_ml: 250,
    });
    await call('POST', '/records', {
      kind: 'food',
      name: '标签食品',
      source: 'label',
      nutrition: {
        calories_kcal: null,
        carbs_g: null,
        protein_g: null,
        fat_g: null,
      },
      label: {
        basis_quantity: 100,
        basis_unit: 'g',
        consumed_quantity: 150,
        consumed_unit: 'g',
        nutrition_per_basis: {
          calories_kcal: 200,
          carbs_g: 20,
          protein_g: 10,
          fat_g: 5,
        },
      },
    });
    await call('POST', '/records', {
      kind: 'water',
      amount_ml: 500,
      local_date: '2026-10-10',
    });
    const corrected = await call('PATCH', '/records/' + water.entity.id, {
      expected_version: 1,
      patch: { amount_ml: 400 },
    });
    expect(
      (await call('GET', '/days/2026-10-11/summary')).water_ml.remaining,
    ).toBe(1600);
    await call('POST', '/records/' + water.entity.id + '/undo', {
      expected_version: corrected.version,
    });
    expect(
      (await call('GET', '/days/2026-10-11/summary')).calories_kcal.known_total,
    ).toBe(300);
    const plan = await call('POST', '/plans', {
      name: '上肢',
      days: ['2026-10-11', '2026-10-12', '2026-10-13'].map((local_date) => ({
        local_date,
        name: '上肢',
        exercises: [exercise],
      })),
    });
    const active = await call('POST', '/plans/' + plan.id + '/confirm', {
      expected_version: plan.version,
    });
    for (let day = 0; day < 2; day++) {
      now = new Date('2026-10-' + (11 + day) + 'T02:00:00Z');
      let session = await call('POST', '/workout-sessions', {
        workout_day_id: active.days[day].id,
      });
      for (let set = 0; set < 3; set++) {
        const result = await call(
          'POST',
          '/workout-sessions/' + session.id + '/sets',
          {
            exercise_id: 'bench',
            weight_kg: 100,
            reps: 12,
            difficulty: 'easy',
          },
        );
        session = result.session;
        expect(result.set.weight_kg).toBe(100);
      }
      session = await call('PATCH', '/workout-sessions/' + session.id, {
        expected_version: session.version,
        action: 'complete',
      });
    }
    const recommendations = await call('GET', '/recommendations');
    const r = recommendations.find((r: any) => r.type === 'next_workout');
    expect(r.weight_kg).toBe(102.5);
    const key = randomUUID();
    const accepted = await call(
      'POST',
      '/recommendations/' + r.id + '/accept',
      { expected_version: r.version },
      key,
    );
    expect(accepted.plan.days[2].exercises[0].weight_kg).toBe(102.5);
    expect(
      await call(
        'POST',
        '/recommendations/' + r.id + '/accept',
        { expected_version: r.version },
        key,
      ),
    ).toEqual(accepted);
    await h.reopen();
    expect((await call('GET', '/plans/' + plan.id)).version).toBe(
      accepted.plan.version,
    );
    expect(
      (await call('GET', '/days/2026-10-10/summary')).water_ml.known_total,
    ).toBe(500);
    expect(
      (await call('GET', '/workout-sessions')).flatMap((s: any) => s.sets),
    ).toHaveLength(6);
  } finally {
    await h.close();
  }
});
