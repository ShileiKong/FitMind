import { it, expect } from 'vitest';
import { makeHarness } from './helpers.js';
it('body_trend_keeps_dates', async () => {
  const h = await makeHarness();
  try {
    await h.services.records.create(h.ctx, {
      kind: 'body',
      metric: 'weight_kg',
      value: 70,
      local_date: '2026-10-10',
    });
    const t = await h.services.trends.query('personal', {
      metric: 'weight_kg',
    });
    expect(t.points[0]).toMatchObject({ local_date: '2026-10-10', value: 70 });
  } finally {
    await h.close();
  }
});
it('profile_timezone_changes_current_context', async () => {
  const h = await makeHarness();
  try {
    await h.services.profile.update(h.ctx, {
      expected_version: 0,
      timezone: 'America/Los_Angeles',
      reminder_time: '20:30',
    });
    const r = await h.app.inject({
      url: '/api/v1/context',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(r.json().data.local_date).toBe('2026-10-10');
    expect(h.services.profile.get('personal').reminder_time).toBe('20:30');
  } finally {
    await h.close();
  }
});
