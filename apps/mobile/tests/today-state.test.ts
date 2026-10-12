import { it, expect } from 'vitest';
import { TodayController } from '../src/state/today';
it('receipt_refreshes_affected_date', async () => {
  const paths: string[] = [];
  const api: any = {
    request: async (_: any, p: string) => {
      paths.push(p);
      return {
        data:
          p === '/context'
            ? { local_date: '2026-10-11' }
            : { local_date: p.split('/')[2] },
      };
    },
  };
  const c = new TodayController(api);
  await c.refresh('2026-10-10');
  await c.applyReceipt({ affected_dates: ['2026-10-10'] } as any);
  expect(paths.filter((p) => p.includes('/2026-10-10/summary'))).toHaveLength(
    2,
  );
});
it('date_rollover_reloads_summary', async () => {
  let date = '2026-10-11';
  const api: any = {
    request: async (_: any, p: string) => ({
      data:
        p === '/context'
          ? { local_date: date }
          : { local_date: p.split('/')[2] },
    }),
  };
  const c = new TodayController(api);
  await c.refresh();
  date = '2026-10-12';
  await c.refresh();
  expect(c.date).toBe('2026-10-12');
  expect(c.summary.local_date).toBe('2026-10-12');
});
