import { afterEach, expect, it, vi } from 'vitest';
import { makeHarness } from './helpers.js';

let h: any;
afterEach(async () => {
  if (h) await h.close();
  h = null;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('a slow multi-round reply finishes without losing its saved receipt', async () => {
  vi.stubEnv('AGENT_MODEL_TIMEOUT_MS', undefined);
  vi.stubEnv('AGENT_MESSAGE_TIMEOUT_MS', undefined);
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  });
  const steps = [
    {
      tool_calls: [
        {
          name: 'record_water',
          call_id: 'water',
          arguments: { amount_ml: 250, date_expression: '今天', note: null },
        },
      ],
    },
    {
      tool_calls: [{ name: 'get_context', call_id: 'context', arguments: {} }],
    },
    { assistant_text: '已保存 250 毫升水', tool_calls: [] },
  ];
  let round = 0;
  h = await makeHarness({
    providers: {
      text: {
        next: async () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(steps[round++]), 40000);
          }),
      },
    },
  });
  const pending = h.services.agent.submit(h.ctx, {
    message_id: 'slow-reply',
    conversation_id: 'main',
    text: '今天喝了250毫升水',
  });
  await vi.advanceTimersByTimeAsync(120001);
  const result = await pending;
  expect(result.status).toBe('completed');
  expect(result.record_receipts).toHaveLength(1);
  expect((await h.services.records.list('personal')).items).toHaveLength(1);
});
