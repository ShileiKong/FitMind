import type { Clock, CommandContext, ReminderSpec } from '@fitmind/contracts';
import type { EntityStore } from '@fitmind/contracts';
import { PlanService } from '../plans/service.js';
import { ProfileService } from '../profile/service.js';
import { resolveDate } from '../time/service.js';
export function zonedLocalToUtc(date: string, time: string, timezone: string) {
  const target = Date.parse(date + 'T' + time + ':00Z');
  let guess = target;
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  for (let i = 0; i < 4; i++) {
    const p = Object.fromEntries(
      fmt.formatToParts(new Date(guess)).map((x) => [x.type, x.value]),
    );
    const local = Date.parse(
      p.year +
        '-' +
        p.month +
        '-' +
        p.day +
        'T' +
        p.hour +
        ':' +
        p.minute +
        ':' +
        p.second +
        'Z',
    );
    const next = guess + target - local;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess).toISOString();
}
export class ReminderService {
  constructor(
    private store: EntityStore,
    private plans: PlanService,
    private profile: ProfileService,
    private clock: Clock,
  ) {}
  async list(user: string): Promise<ReminderSpec[]> {
    const p = this.profile.get(user);
    if (!p.notifications_enabled) return [];
    return this.plans
      .days(user)
      .map((d) => ({
        workout_day_id: d.id,
        plan_version: d.plan_version,
        fire_at_utc: zonedLocalToUtc(
          resolveDate('昨天', d.local_date),
          p.reminder_time,
          p.timezone,
        ),
        training_date: d.local_date,
        timezone: p.timezone,
        title: '明天 · ' + d.name,
        body: d.exercises.map((e) => e.name + ' ' + e.sets + '组').join(' / '),
      }))
      .filter((r) => Date.parse(r.fire_at_utc) > this.clock().getTime());
  }
  async reportDeviceStatus(ctx: CommandContext, input: any) {
    return this.store.mutate(ctx, 'reminder.device', input, () => {
      const r = {
        ...input,
        id: 'device-' + ctx.user_id,
        version:
          (this.store.list<any>(ctx.user_id, 'device')[0]?.version ?? 0) + 1,
        updated_at: ctx.now_utc,
      };
      this.store.put(ctx.user_id, 'device', r);
      return r;
    });
  }
}
