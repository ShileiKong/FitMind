import { it, expect } from 'vitest';
import { Outbox } from '../src/storage/outbox';
const item = {
  idempotency_key: 'key',
  message_id: 'm',
  captured_at: '2026-10-11T15:00:00Z',
  capture_timezone: 'Asia/Shanghai',
  capture_local_date: '2026-10-11',
  workout_session_id: null,
  path: '/chat',
  method: 'POST',
  body: {
    message_id: 'm',
    conversation_id: 'main',
    text: '昨天喝了 300ml 水',
    offline_queued: true,
    captured_at: '2026-10-11T15:00:00Z',
    capture_timezone: 'Asia/Shanghai',
    capture_local_date: '2026-10-11',
  },
  local_attachments: [],
};
function storage() {
  const values: any = {};
  return {
    get: async (key: string) =>
      values[key] ? JSON.parse(JSON.stringify(values[key])) : null,
    set: async (key: string, v: any) => {
      values[key] = JSON.parse(JSON.stringify(v));
    },
  };
}
it('midnight_queue_keeps_capture_day', async () => {
  const s = storage(),
    q = new Outbox(s, 'test');
  await q.enqueue(item);
  let sent: any;
  await q.flush({
    request: async (_: any, __: any, b: any) => {
      sent = b;
      return { data: { status: 'completed' } };
    },
  } as any);
  expect(sent.capture_local_date).toBe('2026-10-11');
  expect(sent.text).toContain('昨天');
});
it('double_flush_does_not_duplicate', async () => {
  const q = new Outbox(storage(), 'test');
  await q.enqueue(item);
  let calls = 0;
  const client: any = {
    request: async () => {
      calls++;
      return { data: { status: 'completed' } };
    },
  };
  await Promise.all([q.flush(client), q.flush(client)]);
  expect(calls).toBe(1);
});
it('restart_keeps_pending_input', async () => {
  const s = storage();
  await new Outbox(s, 'test').enqueue(item);
  expect((await new Outbox(s, 'test').list())[0]).toMatchObject(item);
});
it('two explicit offline set intents with identical values are both retained', async () => {
  const q = new Outbox(storage(), 'test');
  const body = { exercise_id: 'bench', weight_kg: 40, reps: 10 };
  await q.enqueue({
    ...item,
    path: '/workout-sessions/s/sets',
    body,
    idempotency_key: 'set-1',
  });
  await q.enqueue({
    ...item,
    path: '/workout-sessions/s/sets',
    body,
    idempotency_key: 'set-2',
  });
  expect(await q.list()).toHaveLength(2);
});
it('a failed chat response is not a final acknowledgement and can recover with the original message ID', async () => {
  const q = new Outbox(storage(), 'test');
  let ready = false;
  const sent: string[] = [];
  const client: any = {
    request: async (_: any, __: any, body: any) => {
      sent.push(body.message_id);
      return {
        data: ready
          ? { status: 'completed', message_id: body.message_id }
          : {
              status: 'partial',
              message_id: body.message_id,
              record_receipts: [{ id: 'already-saved' }],
              error: {
                code: 'MODEL_TIMEOUT',
                message: 'timeout',
                retryable: true,
              },
            },
      };
    },
  };
  await q.enqueue(item);
  await q.flush(client);
  expect(await q.acknowledged(item.idempotency_key)).toBeNull();
  expect(await q.list()).toHaveLength(1);
  ready = true;
  await q.flush(client);
  expect(await q.acknowledged(item.idempotency_key)).toMatchObject({
    status: 'completed',
  });
  expect(sent).toEqual(['m', 'm']);
  expect(await q.list()).toHaveLength(0);
});
