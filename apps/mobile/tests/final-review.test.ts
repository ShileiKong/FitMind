import { it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Outbox } from '../src/storage/outbox';
import { SubmissionIntent } from '../src/state/submission-intent';
import { dashboardClock } from '../src/state/dashboard-clock';
const state = vi.hoisted(() => ({
  app: {
    credentials: {},
    offline: true,
    pendingInputs: [],
    context: { local_date: '2026-10-11' },
    api: { request: vi.fn() },
    records: [] as any[],
    targets: [],
    memories: [],
    sessions: [
      {
        id: 'session',
        version: 1,
        local_date: '2026-10-11',
        status: 'active',
        current_exercise_id: 'bench',
        sets: [],
        snapshot: {
          name: 'A',
          exercises: [
            {
              exercise_id: 'bench',
              name: '卧推',
              sets: 3,
              weight_kg: 100,
              reps_min: 8,
              reps_max: 12,
              rest_seconds: 90,
            },
          ],
        },
      },
    ],
    mutate: vi.fn(),
    removePending: vi.fn(),
  },
  params: { id: 'session', mode: 'water' } as any,
}));
vi.mock('../src/state/app', () => ({ useApp: () => state.app }));
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => state.params,
  router: { back: vi.fn(), push: vi.fn() },
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
  View: 'div',
  Text: 'span',
  Switch: 'input',
  Pressable: 'button',
  StyleSheet: { create: (s: any) => s },
}));
vi.mock('../src/components/ui', () => ({
  Screen: 'main',
  Card: 'section',
  Loading: () => React.createElement('span', null, 'Loading'),
  Field: () => null,
  Button: ({ title, disabled }: any) =>
    React.createElement('button', { disabled }, title),
}));
vi.mock('../src/components/ChatComposer', () => ({ ChatComposer: () => null }));
vi.mock('../src/storage/cache', () => ({
  CacheStore: { get: async () => null, set: async () => {} },
}));
vi.mock('../src/native/rest-timer', () => ({
  RestTimer: { remaining: () => 0 },
}));
vi.mock('../src/native/expo-notifications', () => ({
  notifications: { reconcile: vi.fn() },
}));
import Workout from '../src/app/workout/[id]';
import Editor from '../src/app/editor';
function storage() {
  const values: any = {};
  return {
    get: async (k: string) => values[k] ?? null,
    set: async (k: string, v: any) => {
      values[k] = JSON.parse(JSON.stringify(v));
    },
  };
}
it('manual form retry after background recovery keeps one logical record, a new form can count again', async () => {
  const q = new Outbox(storage(), 'q');
  let facts = 0,
    lose = true;
  const receipts = new Map();
  const client: any = {
    request: async (_: any, __: any, ___: any, o: any) => {
      if (!receipts.has(o.idempotency_key))
        receipts.set(o.idempotency_key, { id: ++facts });
      if (lose) {
        lose = false;
        throw new Error('lost reply');
      }
      return { data: receipts.get(o.idempotency_key) };
    },
  };
  const intent = new SubmissionIntent(() => crypto.randomUUID());
  const submit = async (
    path: string,
    body: any,
    method: string,
    key: string,
  ) => {
    const ack = await q.result(key);
    if (ack) return ack;
    await q.enqueue({
      path,
      body,
      method,
      idempotency_key: key,
      message_id: null,
      captured_at: '2026-10-11T00:00:00Z',
      capture_timezone: 'Asia/Shanghai',
      capture_local_date: '2026-10-11',
      workout_session_id: null,
      local_attachments: [],
    });
    await q.flush(client);
    const r = await q.result(key);
    if (!r) throw new Error('queued');
    return r;
  };
  await expect(
    intent.run(submit, '/records', { kind: 'water', amount_ml: 250 }, 'POST'),
  ).rejects.toThrow('queued');
  await q.flush(client);
  expect(
    await intent.run(
      submit,
      '/records',
      { kind: 'water', amount_ml: 250 },
      'POST',
    ),
  ).toEqual({ id: 1 });
  expect(facts).toBe(1);
  intent.complete();
  await intent.run(
    submit,
    '/records',
    { kind: 'water', amount_ml: 250 },
    'POST',
  );
  expect(facts).toBe(2);
});
it('changing an unresolved form cannot silently create a second uncertain record', async () => {
  const intent = new SubmissionIntent(() => crypto.randomUUID());
  await expect(
    intent.run(
      async () => {
        throw new Error('queued');
      },
      '/records',
      { amount_ml: 250 },
      'POST',
    ),
  ).rejects.toThrow('queued');
  await expect(
    intent.run(async () => ({}), '/records', { amount_ml: 300 }, 'POST'),
  ).rejects.toThrow(/原提交/);
});
it('background cursor and version updates do not change an unresolved set submission', async () => {
  const intent = new SubmissionIntent(() => 'one-set');
  let sent: any;
  await expect(
    intent.run(
      async () => {
        throw new Error('queued');
      },
      '/workout-sessions/s/sets',
      { exercise_id: 'bench', reps: 12, weight_kg: 40 },
      'POST',
    ),
  ).rejects.toThrow();
  await intent.run(
    async (_: any, body: any) => {
      sent = body;
      return { set: { id: 'saved' } };
    },
    '/workout-sessions/s/sets',
    { exercise_id: 'squat', reps: 12, weight_kg: 40 },
    'POST',
  );
  expect(sent.exercise_id).toBe('bench');
});
it('offline cached workout exposes actual set recording controls', () => {
  state.params = { id: 'session' };
  const html = renderToStaticMarkup(React.createElement(Workout));
  expect(html).toContain('保存实际组');
  expect(html).toContain('卧推');
  expect(html).not.toContain('Loading');
});
it('existing editor ID cannot fall back to a create form while loading fails', () => {
  state.params = { id: 'unloaded-record', mode: 'water' };
  const html = renderToStaticMarkup(React.createElement(Editor));
  expect(html).toMatch(/<button disabled="">保存记录<\/button>/);
});
it('long background sync across midnight does not change the cached clock calibration', () => {
  const received = Date.parse('2026-10-11T15:59:50Z');
  const calibration = dashboardClock(
    { now_utc: '2026-10-11T15:59:50Z' },
    received,
  );
  const cache = JSON.parse(
    JSON.stringify({ calibration, saved_at: received + 80000 }),
  );
  const capture = new Date(
    Date.parse('2026-10-11T16:01:15Z') + cache.calibration.offset_ms,
  );
  expect(capture.toISOString()).toBe('2026-10-11T16:01:15.000Z');
});
