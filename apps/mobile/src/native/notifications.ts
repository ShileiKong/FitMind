import type { ReminderSpec } from '@fitmind/contracts';
export interface NotificationPort {
  permission: () => Promise<string>;
  list: () => Promise<{ id: string; spec: ReminderSpec }[]>;
  cancel: (id: string) => Promise<void>;
  schedule: (spec: ReminderSpec) => Promise<string>;
  limit?: number;
}
export class NotificationAdapter {
  private queue: Promise<any> = Promise.resolve();
  constructor(
    private port: NotificationPort,
    private clock: () => number = Date.now,
  ) {}
  reconcile(specs: ReminderSpec[]) {
    const work = this.queue.then(() => this.sync(specs));
    this.queue = work.catch(() => {});
    return work;
  }
  private async sync(specs: ReminderSpec[]) {
    const permission = await this.port.permission();
    const result = {
      permission,
      scheduled: [] as string[],
      cancelled: [] as string[],
      failed: [] as string[],
      deferred: 0,
    };
    const future = specs
      .filter((s) => Date.parse(s.fire_at_utc) > this.clock())
      .sort((a, b) => a.fire_at_utc.localeCompare(b.fire_at_utc));
    const wanted =
      permission === 'granted' ? future.slice(0, this.port.limit ?? 60) : [];
    result.deferred = Math.max(0, future.length - wanted.length);
    const existing = await this.port.list();
    const same = (a: ReminderSpec, b: ReminderSpec) =>
      a.workout_day_id === b.workout_day_id &&
      a.plan_version === b.plan_version &&
      a.fire_at_utc === b.fire_at_utc &&
      a.title === b.title &&
      a.body === b.body;
    for (const old of existing)
      if (!wanted.some((s) => same(s, old.spec))) {
        try {
          await this.port.cancel(old.id);
          result.cancelled.push(old.id);
        } catch {
          result.failed.push(old.id);
        }
      }
    for (const spec of wanted)
      if (!existing.some((old) => same(old.spec, spec))) {
        try {
          result.scheduled.push(await this.port.schedule(spec));
        } catch {
          result.failed.push(spec.workout_day_id);
        }
      }
    return result;
  }
}
