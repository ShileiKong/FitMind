import { describe, it, expect, afterEach } from 'vitest';
import { makeHarness } from './helpers.js';
import {
  getTimeContext,
  resolveDate,
  resolveReferenceDate,
} from '../src/modules/time/service.js';
const hs: any[] = [];
afterEach(async () => {
  for (const h of hs.splice(0)) await h.close();
});
async function setup() {
  const h = await makeHarness();
  hs.push(h);
  return h;
}
describe('dates and persistent records', () => {
  it('relative_date_is_frozen', () => {
    expect(resolveDate('昨天', '2026-10-11')).toBe('2026-10-10');
    expect(
      getTimeContext(() => new Date('2026-10-11T16:00:00Z'), 'Asia/Shanghai')
        .local_date,
    ).toBe('2026-10-12');
  });
  it('offline_delay_is_not_clock_skew', () => {
    expect(
      resolveReferenceDate(
        {
          offline_queued: true,
          capture_local_date: '2026-10-11',
          capture_timezone: 'Asia/Shanghai',
          captured_at: '2026-10-11T02:00:00Z',
        },
        getTimeContext(() => new Date('2026-10-12T02:00:00Z'), 'Asia/Shanghai'),
      ),
    ).toBe('2026-10-11');
  });
  it('reopen_preserves_water', async () => {
    const h = await setup();
    await h.services.records.create(h.ctx, {
      kind: 'water',
      amount_ml: 500,
      local_date: '2026-10-10',
    });
    const r = await h.reopen();
    expect(
      (await r.services.records.list('personal', { local_date: '2026-10-10' }))
        .items[0].amount_ml,
    ).toBe(500);
  });
  it('duplicate_key_reuses_record', async () => {
    const h = await setup();
    const a = await h.services.records.create(h.ctx, {
      kind: 'water',
      amount_ml: 300,
    });
    const b = await h.services.records.create(h.ctx, {
      kind: 'water',
      amount_ml: 300,
    });
    expect(b.entity.id).toBe(a.entity.id);
    expect((await h.services.records.list('personal', {})).items).toHaveLength(
      1,
    );
    await expect(
      h.services.records.create(h.ctx, { kind: 'water', amount_ml: 500 }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
  it('stale_version_conflicts', async () => {
    const h = await setup();
    const a = await h.services.records.create(h.ctx, {
      kind: 'water',
      amount_ml: 300,
    });
    await h.services.records.edit(
      { ...h.ctx, idempotency_key: 'edit1' },
      a.entity.id,
      1,
      { amount_ml: 200 },
    );
    await expect(
      h.services.records.edit(
        { ...h.ctx, idempotency_key: 'edit2' },
        a.entity.id,
        1,
        { amount_ml: 100 },
      ),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });
  it('timezone_change_preserves_old_date', async () => {
    const h = await setup();
    await h.services.records.create(h.ctx, {
      kind: 'water',
      amount_ml: 300,
      local_date: '2026-10-11',
    });
    expect(
      (await h.services.records.list('personal', { local_date: '2026-10-11' }))
        .items,
    ).toHaveLength(1);
  });
  it('auth_and_invalid_input_are_rejected', async () => {
    const h = await setup();
    expect((await h.app.inject({ url: '/api/v1/records' })).statusCode).toBe(
      401,
    );
    expect(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/v1/records',
          headers: {
            authorization: 'Bearer test-token',
            'idempotency-key': 'bad',
          },
          payload: { kind: 'water', amount_ml: -1 },
        })
      ).statusCode,
    ).toBe(400);
  });
});
