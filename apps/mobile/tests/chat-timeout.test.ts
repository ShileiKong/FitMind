import { afterEach, expect, it, vi } from 'vitest';
import { ApiClient } from '../src/api/client';
import { Outbox } from '../src/storage/outbox';

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

function delayedClient() {
  return new ApiClient({
    base_url: 'http://localhost:8787',
    getToken: async () => 'test',
    fetch: async (_: any, init: any) =>
      new Promise<Response>((resolve, reject) => {
        setTimeout(
          () =>
            resolve(
              new Response(
                JSON.stringify({
                  data: { message_id: 'm', status: 'completed' },
                  request_id: 'r',
                  server_time: 'now',
                  timezone: 'Asia/Shanghai',
                }),
              ),
            ),
          120000,
        );
        init.signal.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      }),
  });
}

it.each(['/chat', '/messages/m/recover'])(
  'outbox lets a slow %s reply complete rather than queuing a false timeout',
  async (path) => {
    vi.useFakeTimers();
    const values = new Map<string, any>();
    const q = new Outbox(
      {
        get: async (key: string) => values.get(key),
        set: async (key: string, value: any) => values.set(key, value),
      },
      'q',
    );
    await q.enqueue({
      idempotency_key: 'stable',
      message_id: 'm',
      captured_at: '2026-10-11T05:00:00Z',
      capture_timezone: 'Asia/Shanghai',
      capture_local_date: '2026-10-11',
      workout_session_id: null,
      method: 'POST',
      path,
      body: {},
      local_attachments: [],
    });
    const pending = q.flush(delayedClient());
    await vi.advanceTimersByTimeAsync(120001);
    const result = await pending;
    expect(result.pending).toHaveLength(0);
    expect(result.completed[0].result.status).toBe('completed');
    expect(await q.list()).toHaveLength(0);
  },
);
