import { it, expect } from 'vitest';
import { handleResponse } from '../src/native/notification-routing';
it('old_notification_loads_latest_day', async () => {
  let path = '';
  const api: any = {
    request: async (_: any, p: string) => {
      path = p;
      return {
        data: {
          id: 'day',
          plan_id: 'plan',
          plan_version: 7,
          status: 'cancelled',
        },
      };
    },
  };
  const d = await handleResponse(api, {
    workout_day_id: 'day',
    plan_version: 1,
  });
  expect(path).toBe('/workout-days/day');
  expect(d).toMatchObject({ day_id: 'day', status: 'cancelled' });
});
