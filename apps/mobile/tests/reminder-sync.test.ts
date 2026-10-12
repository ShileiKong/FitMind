import { it, expect } from 'vitest';
import { NotificationAdapter } from '../src/native/notifications';
import {
  syncReminderStatus,
  reminderNotice,
} from '../src/native/reminder-status';

it('automatic scheduling item failures are surfaced before reporting', async () => {
  let visible: any;
  let reported: any;
  const result = {
    permission: 'granted',
    scheduled: [],
    cancelled: [],
    failed: ['day-1'],
    deferred: 0,
  };
  await syncReminderStatus(
    {
      request: async (method: string, _: string, body: any) => {
        if (method === 'POST') reported = body;
        return { data: [] };
      },
    } as any,
    { reconcile: async () => result } as any,
    (r: any) => {
      visible = reminderNotice(r);
    },
    true,
    () => 'report-key',
  );
  expect(visible).toMatch(/1.*失败/);
  expect(reported.failed).toEqual(['day-1']);
});
const spec = {
  workout_day_id: 'day',
  plan_version: 2,
  fire_at_utc: '2026-10-11T13:00:00Z',
  training_date: '2026-10-12',
  timezone: 'Asia/Shanghai',
  title: '明天',
  body: '上肢',
};
function port(permission = 'granted', old: any[] = []) {
  const cancelled: string[] = [],
    scheduled: any[] = [];
  return {
    permission: async () => permission,
    list: async () => old,
    cancel: async (id: string) => {
      cancelled.push(id);
    },
    schedule: async (s: any) => {
      scheduled.push(s);
      return 'new';
    },
    cancelled,
    scheduled,
  };
}
it('edited_plan_replaces_old_notification', async () => {
  const p = port('granted', [
    { id: 'old', spec: { ...spec, plan_version: 1 } },
  ]);
  const r = await new NotificationAdapter(p, () =>
    Date.parse('2026-10-11T02:00Z'),
  ).reconcile([spec]);
  expect(p.cancelled).toEqual(['old']);
  expect(r.scheduled).toHaveLength(1);
});
it('cancelled_plan_has_no_schedule', async () => {
  const p = port('granted', [{ id: 'old', spec }]);
  await new NotificationAdapter(p).reconcile([]);
  expect(p.cancelled).toEqual(['old']);
  expect(p.scheduled).toEqual([]);
});
it('denied_permission_is_visible', async () => {
  const r = await new NotificationAdapter(port('denied')).reconcile([spec]);
  expect(r.permission).toBe('denied');
  expect(r.scheduled).toEqual([]);
});
it('late_confirmation_does_not_schedule_past', async () => {
  const p = port();
  await new NotificationAdapter(p, () =>
    Date.parse('2026-10-11T14:00Z'),
  ).reconcile([spec]);
  expect(p.scheduled).toEqual([]);
});
