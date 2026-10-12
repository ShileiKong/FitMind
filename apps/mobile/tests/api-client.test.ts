import { it, expect } from 'vitest';
import { ApiClient } from '../src/api/client';
it('auth_header', async () => {
  let init: any;
  const c = new ApiClient({
    base_url: 'http://localhost:8787',
    getToken: async () => 'secret',
    fetch: async (_: any, i: any) => {
      init = i;
      return new Response(
        JSON.stringify({
          data: { ok: true },
          request_id: 'r',
          server_time: 'now',
          timezone: 'Asia/Shanghai',
        }),
      );
    },
  });
  await c.request(
    'POST',
    '/records',
    { kind: 'water', amount_ml: 250 },
    { idempotency_key: 'stable' },
  );
  expect(init.headers.Authorization).toBe('Bearer secret');
  expect(init.headers['Idempotency-Key']).toBe('stable');
});
it('api_error_retains_draft', async () => {
  const body = { text: '喝水', message_id: 'm' };
  const c = new ApiClient({
    base_url: 'http://localhost',
    getToken: async () => '',
    fetch: async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 'AI_UNCONFIGURED',
            message: '请配置',
            retryable: false,
          },
          request_id: 'r',
        }),
        { status: 503 },
      ),
  });
  await expect(c.request('POST', '/chat', body)).rejects.toMatchObject({
    code: 'AI_UNCONFIGURED',
    retryable: false,
  });
  expect(body.text).toBe('喝水');
});
