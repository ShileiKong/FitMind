import { it, expect, afterEach } from 'vitest';
import { makeHarness } from './helpers.js';
let h: any;
afterEach(async () => {
  if (h) await h.close();
});
it('browser_edit_preflight_allows_patch', async () => {
  h = await makeHarness();
  const r = await h.app.inject({
    method: 'OPTIONS',
    url: '/api/v1/records/some-id',
    headers: {
      origin: 'http://127.0.0.1:8081',
      'access-control-request-method': 'PATCH',
      'access-control-request-headers':
        'authorization,content-type,idempotency-key',
    },
  });
  expect(r.statusCode).toBe(204);
  expect(r.headers['access-control-allow-methods']).toContain('PATCH');
});
it('http_preserves_unknown_nutrition_and_target', async () => {
  h = await makeHarness();
  const headers = {
    authorization: 'Bearer test-token',
    'idempotency-key': 'food',
  };
  const f = await h.app.inject({
    method: 'POST',
    url: '/api/v1/records',
    headers,
    payload: {
      kind: 'food',
      name: '午餐',
      source: 'estimate',
      nutrition: {
        calories_kcal: 200,
        carbs_g: null,
        protein_g: null,
        fat_g: null,
      },
    },
  });
  expect(f.statusCode).toBe(200);
  expect(f.json().data.entity.nutrition.protein_g).toBeNull();
  const t = await h.app.inject({
    method: 'POST',
    url: '/api/v1/targets/drafts',
    headers: { ...headers, 'idempotency-key': 'target' },
    payload: {
      effective_from: '2026-10-11',
      water_ml: 2000,
      calories_kcal: 2000,
      carbs_g: null,
      protein_g: null,
      fat_g: null,
    },
  });
  expect(t.json().data.protein_g).toBeNull();
});
