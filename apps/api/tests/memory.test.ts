import { it, expect, afterEach } from 'vitest';
import { makeHarness } from './helpers.js';
let h: any;
afterEach(async () => {
  if (h) await h.close();
  h = null;
});
it('deleted_memory_not_relearned_from_old_source', async () => {
  h = await makeHarness();
  const m = await h.services.memory.remember(h.ctx, {
    key: 'preference',
    value: '晚上训练',
    source_message_id: 'old',
  });
  await h.services.memory.forget(
    { ...h.ctx, idempotency_key: 'forget' },
    m.id,
    1,
  );
  await expect(
    h.services.memory.remember(
      { ...h.ctx, idempotency_key: 'again' },
      { key: 'preference', value: '晚上训练', source_message_id: 'old' },
    ),
  ).rejects.toMatchObject({ code: 'DELETED_SOURCE' });
});
it('explicit_new_source_can_restore', async () => {
  h = await makeHarness();
  const m = await h.services.memory.remember(h.ctx, {
    key: 'preference',
    value: '晚上训练',
    source_message_id: 'old',
  });
  await h.services.memory.forget(
    { ...h.ctx, idempotency_key: 'forget' },
    m.id,
    1,
  );
  const n = await h.services.memory.remember(
    { ...h.ctx, idempotency_key: 'new' },
    { key: 'preference', value: '早上训练', source_message_id: 'new' },
  );
  expect(n.value).toBe('早上训练');
});
it('query_yesterday_reads_records', async () => {
  h = await makeHarness();
  await h.services.records.create(h.ctx, {
    kind: 'water',
    amount_ml: 500,
    local_date: '2026-10-10',
  });
  const c = await h.services.memory.buildContext('personal', {
    text: '昨天喝了多少水',
    reference_local_date: '2026-10-11',
  });
  expect(c.relevant_summary.water_ml.known_total).toBe(500);
});
it('history_uses_same_exercise', async () => {
  h = await makeHarness();
  const c = await h.services.memory.buildContext('personal', {
    text: '卧推',
    reference_local_date: '2026-10-11',
  });
  expect(c.exercise_history).toEqual([]);
  expect(c.memories).toEqual([]);
});
