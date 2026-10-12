import { it, expect } from 'vitest';
import { makeHarness } from './helpers.js';
const publicRoutes = [
  ['get', '/health'],
  ['get', '/capabilities'],
  ['get', '/context'],
  ['get', '/profile'],
  ['patch', '/profile'],
  ['get', '/days/{date}/summary'],
  ['get', '/targets'],
  ['post', '/targets/drafts'],
  ['post', '/targets/drafts/{id}/confirm'],
  ['post', '/chat/messages'],
  ['get', '/chat/messages/{id}'],
  ['get', '/chat/conversations/{id}/messages'],
  ['get', '/records'],
  ['post', '/records'],
  ['patch', '/records/{id}'],
  ['post', '/records/{id}/undo'],
  ['get', '/plans'],
  ['post', '/plans'],
  ['get', '/plans/{id}'],
  ['post', '/plans/{id}/confirm'],
  ['patch', '/plans/{id}'],
  ['post', '/plans/{id}/cancel'],
  ['get', '/workout-days/{id}'],
  ['post', '/workout-sessions'],
  ['get', '/workout-sessions/{id}'],
  ['patch', '/workout-sessions/{id}'],
  ['post', '/workout-sessions/{id}/sets'],
  ['patch', '/workout-sets/{id}'],
  ['post', '/workout-sets/{id}/undo'],
  ['get', '/workout-sessions/{id}/recommendations'],
  ['post', '/recommendations/{id}/accept'],
  ['post', '/media/images'],
  ['post', '/nutrition/analyze'],
  ['post', '/audio/transcriptions'],
  ['get', '/memories'],
  ['patch', '/memories/{id}'],
  ['delete', '/memories/{id}'],
  ['get', '/trends'],
  ['get', '/reminders'],
  ['post', '/reminders/device-status'],
] as const;
it('public_spec_matches_routes', async () => {
  const h = await makeHarness();
  try {
    const response = await h.app.inject({
      url: '/api/v1/openapi.json',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(response.statusCode).toBe(200);
    const spec = response.json();
    for (const [method, path] of publicRoutes)
      expect(
        spec.paths['/api/v1' + path]?.[method],
        method + ' ' + path,
      ).toBeDefined();
    expect(spec.components.securitySchemes.personalToken.type).toBe('http');
    expect(
      spec.paths['/api/v1/records'].post.parameters.some(
        (p: any) => p.name === 'Idempotency-Key',
      ),
    ).toBe(true);
  } finally {
    await h.close();
  }
});
it('secret_values_never_appear_in_responses', async () => {
  const h = await makeHarness();
  try {
    for (const url of [
      '/api/v1/health',
      '/api/v1/capabilities',
      '/api/v1/context',
      '/api/v1/openapi.json',
    ]) {
      const r = await h.app.inject({
        url,
        headers: { authorization: 'Bearer test-token' },
      });
      expect(r.statusCode).toBe(200);
      expect(r.body).not.toContain('test-token');
      expect(r.body).not.toContain('api_key');
    }
    expect(
      (await h.app.inject({ url: '/api/v1/openapi.json' })).statusCode,
    ).toBe(401);
  } finally {
    await h.close();
  }
});
it('food_attachments_must_be_owned_images', async () => {
  const h = await makeHarness();
  try {
    await expect(
      h.services.records.create(h.ctx, {
        kind: 'food',
        name: '餐食',
        source: 'estimate',
        nutrition: {
          calories_kcal: 300,
          carbs_g: null,
          protein_g: null,
          fat_g: null,
        },
        attachment_ids: ['nonexistent'],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  } finally {
    await h.close();
  }
});
it('intake_and_workout_trends_are_real_facts', async () => {
  const h = await makeHarness();
  try {
    await h.services.records.create(h.ctx, {
      kind: 'water',
      amount_ml: 250,
      local_date: '2026-10-10',
    });
    const result = await h.services.trends.query('personal', {
      metric: 'water_ml',
    });
    expect(result.points).toEqual([
      expect.objectContaining({ local_date: '2026-10-10', value: 250 }),
    ]);
  } finally {
    await h.close();
  }
});
it('device_report_cannot_overwrite_a_business_entity', async () => {
  const h = await makeHarness();
  try {
    const water = await h.services.records.create(h.ctx, {
      kind: 'water',
      amount_ml: 250,
    });
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/reminders/device-status',
      headers: {
        authorization: 'Bearer test-token',
        'idempotency-key': 'device-report',
      },
      payload: {
        id: water.entity.id,
        permission: 'granted',
        scheduled: [],
        cancelled: [],
        failed: [],
        deferred: 0,
      },
    });
    expect(r.statusCode).toBe(400);
    expect((await h.services.records.list('personal')).items[0].kind).toBe(
      'water',
    );
  } finally {
    await h.close();
  }
});
