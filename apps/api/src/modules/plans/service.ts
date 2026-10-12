import type {
  CommandContext,
  PlanDraftInput,
  PlanView,
  WorkoutDay,
} from '@fitmind/contracts';
import type { EntityStore } from '@fitmind/contracts';
import { invariant } from '../../http/errors.js';
import { validateDate } from '../time/service.js';
function periodFor(
  input: any,
  days: WorkoutDay[],
  previous?: PlanView['period'],
) {
  const r = input.weekly ?? input.repeat;
  if (r) return { start_date: r.start_date, end_date: r.end_date };
  if (!previous) return undefined;
  if (
    days.every(
      (d) =>
        d.local_date >= previous.start_date &&
        d.local_date <= previous.end_date,
    )
  )
    return previous;
  const dates = days.map((d) => d.local_date).sort();
  return { start_date: dates[0], end_date: dates.at(-1)! };
}
function applyFrom(plan: PlanView, date: string): PlanView {
  validateDate(date);
  const start = Date.parse(date);
  const scheduled = [...plan.days].sort((a, b) =>
    a.local_date.localeCompare(b.local_date),
  );
  const dateAt = (time: number) =>
    validateDate(new Date(time).toISOString().slice(0, 10));
  if (!plan.period) {
    const offset = start - Date.parse(scheduled[0].local_date);
    return {
      ...plan,
      days: scheduled.map((day) => ({
        ...day,
        local_date: dateAt(Date.parse(day.local_date) + offset),
      })),
    };
  }
  const startWeekday = new Date(start).getUTCDay();
  const originalStart = Date.parse(plan.period.start_date);
  const originalWeekday = new Date(originalStart).getUTCDay();
  const days = scheduled
    .map((day) => {
      const weekday = new Date(day.local_date).getUTCDay();
      const oldAnchor =
        originalStart + ((weekday - originalWeekday + 7) % 7) * 86400000;
      const newAnchor = start + ((weekday - startWeekday + 7) % 7) * 86400000;
      // Keep skipped weeks and multiple workouts on one date intact.
      const offset = Date.parse(day.local_date) - oldAnchor;
      return { ...day, local_date: dateAt(newAnchor + offset) };
    })
    .sort((a, b) => a.local_date.localeCompare(b.local_date));
  const duration = Date.parse(plan.period.end_date) - originalStart;
  return {
    ...plan,
    days,
    period: {
      start_date: date,
      end_date: dateAt(
        Math.max(start + duration, Date.parse(days.at(-1)!.local_date)),
      ),
    },
  };
}
export class PlanService {
  constructor(private store: EntityStore) {}
  normalize(
    input: any,
    plan_id: string,
    version: number,
    status: any,
    old: WorkoutDay[] = [],
  ): WorkoutDay[] {
    let days = input.days;
    invariant(
      [input.days, input.repeat, input.weekly].filter(Boolean).length <= 1,
      'INVALID_PLAN',
      '按日期安排、同动作循环与周循环请选择一种',
    );
    if (input.repeat || input.weekly) {
      const r = input.weekly ?? input.repeat;
      validateDate(r.start_date);
      validateDate(r.end_date);
      const start = Date.parse(r.start_date),
        end = Date.parse(r.end_date);
      invariant(
        end >= start && end - start <= 365 * 86400000,
        'INVALID_RANGE',
        '循环范围须在一年以内',
      );
      if (input.weekly) {
        invariant(
          Array.isArray(r.days) && r.days.length >= 1 && r.days.length <= 7,
          'INVALID_WEEKLY_PLAN',
          '周循环需要一至七个星期安排',
        );
        invariant(
          r.days.every(
            (d: any) =>
              Number.isInteger(d.weekday) && d.weekday >= 0 && d.weekday <= 6,
          ),
          'INVALID_WEEKDAY',
          '星期需为 0 至 6，0 代表周日',
        );
        invariant(
          new Set(r.days.map((d: any) => d.weekday)).size === r.days.length,
          'DUPLICATE_WEEKDAY',
          '同一个星期只能安排一套训练，多个动作请放在同一天',
        );
      }
      days = [];
      for (let n = start; n <= end; n += 86400000) {
        const weekday = new Date(n).getUTCDay();
        const template = input.weekly
          ? r.days.find((d: any) => d.weekday === weekday)
          : r.weekdays.includes(weekday)
            ? r
            : null;
        if (!template) continue;
        const local_date = new Date(n).toISOString().slice(0, 10);
        const matching = old.filter((d) => d.local_date === local_date);
        days.push({
          ...(matching.length === 1 ? { id: matching[0].id } : {}),
          local_date,
          name: template.name,
          exercises: template.exercises,
        });
      }
    }
    invariant(
      days?.length && days.length <= 366,
      'EMPTY_PLAN',
      '计划需要至少一个训练日',
    );
    const ids = new Set<string>();
    return days.map((d: any) => {
      validateDate(d.local_date);
      invariant(
        d.name?.trim() && d.exercises?.length,
        'INVALID_DAY',
        '请填写训练日名称与动作',
      );
      invariant(
        !d.id || old.some((x) => x.id === d.id),
        'INVALID_DAY_ID',
        '训练日编号不属于这个计划',
      );
      const id = d.id ?? this.store.id();
      invariant(!ids.has(id), 'DUPLICATE_DAY', '训练日编号重复');
      ids.add(id);
      for (const e of d.exercises) {
        invariant(
          e.exercise_id &&
            e.name &&
            e.variant !== undefined &&
            e.equipment !== undefined &&
            ['total', 'per_hand', 'bodyweight', 'machine'].includes(
              e.load_convention,
            ),
          'INVALID_EXERCISE',
          '请填写动作与重量记法',
        );
        invariant(
          Number.isInteger(e.sets) &&
            e.sets >= 1 &&
            e.sets <= 30 &&
            Number.isInteger(e.reps_min) &&
            e.reps_min > 0 &&
            Number.isInteger(e.reps_max) &&
            e.reps_max >= e.reps_min &&
            e.reps_max <= 200,
          'INVALID_REPS',
          '组数或次数区间无效',
        );
        invariant(
          [e.weight_kg, e.increment_kg].every(
            (v) => v === null || (Number.isFinite(v) && v >= 0 && v <= 2000),
          ) &&
            Number.isFinite(e.rest_seconds) &&
            e.rest_seconds >= 0 &&
            e.rest_seconds <= 3600,
          'INVALID_LOAD',
          '重量或休息时长无效',
        );
      }
      invariant(
        new Set(d.exercises.map((e: any) => e.exercise_id)).size ===
          d.exercises.length,
        'DUPLICATE_EXERCISE',
        '同一训练日动作编号必须唯一',
      );
      return {
        id,
        plan_id,
        plan_version: version,
        status,
        local_date: d.local_date,
        name: d.name,
        exercises: d.exercises,
      };
    });
  }
  save(user: string, p: PlanView, old: WorkoutDay[] = []) {
    for (const d of old)
      if (!p.days.some((x) => x.id === d.id))
        this.store.put(user, 'workout_day', {
          ...d,
          status: 'cancelled',
          version: p.version,
          plan_version: p.version,
        });
    this.store.put(user, 'plan', p);
    for (const d of p.days)
      this.store.put(user, 'workout_day', { ...d, version: p.version });
    return p;
  }
  async createDraft(ctx: CommandContext, input: PlanDraftInput) {
    return this.store.mutate(ctx, 'plan.draft', input, () => {
      const id = this.store.id();
      const days = this.normalize(input, id, 1, 'draft');
      const p: PlanView = {
        id,
        version: 1,
        name: input.name,
        status: 'draft',
        days,
        period: periodFor(input, days),
        created_at: ctx.now_utc,
      };
      return this.save(ctx.user_id, p);
    });
  }
  async confirm(
    ctx: CommandContext,
    id: string,
    version: number,
    apply_from?: string,
  ) {
    const payload =
      apply_from === undefined ? { version } : { version, apply_from };
    return this.store.mutate(ctx, 'plan.confirm:' + id, payload, () => {
      const draft = this.get(ctx.user_id, id);
      invariant(
        draft.version === version,
        'VERSION_CONFLICT',
        '计划已更新',
        409,
      );
      invariant(draft.status === 'draft', 'INVALID_STATE', '只能确认计划草案');
      const p = apply_from === undefined ? draft : applyFrom(draft, apply_from);
      const v = p.version + 1;
      return this.save(ctx.user_id, {
        ...p,
        version: v,
        status: 'active',
        days: p.days.map((d) => ({ ...d, status: 'active', plan_version: v })),
      });
    });
  }
  revise(ctx: CommandContext, id: string, version: number, patch: any) {
    return this.store.mutate(
      ctx,
      'plan.revise:' + id,
      { version, patch },
      () => {
        const p = this.get(ctx.user_id, id);
        invariant(p.version === version, 'VERSION_CONFLICT', '计划已更新', 409);
        invariant(p.status !== 'cancelled', 'PLAN_CANCELLED', '计划已取消');
        invariant(
          Object.keys(patch).every((k) =>
            ['name', 'days', 'repeat', 'weekly'].includes(k),
          ),
          'INVALID_PATCH',
          '计划修改字段无效',
        );
        const v = p.version + 1;
        const days = this.normalize(
          patch.days || patch.repeat || patch.weekly ? patch : { days: p.days },
          id,
          v,
          p.status,
          p.days,
        );
        return this.save(
          ctx.user_id,
          {
            ...p,
            name: patch.name ?? p.name,
            version: v,
            days,
            period: periodFor(patch, days, p.period),
          },
          p.days,
        );
      },
    );
  }
  async cancel(ctx: CommandContext, id: string, version: number) {
    return this.store.mutate(ctx, 'plan.cancel:' + id, { version }, () => {
      const p = this.get(ctx.user_id, id);
      invariant(p.version === version, 'VERSION_CONFLICT', '计划已更新', 409);
      return this.save(ctx.user_id, {
        ...p,
        status: 'cancelled',
        version: p.version + 1,
        days: p.days.map((d) => ({
          ...d,
          status: 'cancelled',
          plan_version: p.version + 1,
        })),
      });
    });
  }
  get(user: string, id: string) {
    return this.store.get<PlanView>(user, 'plan', id);
  }
  list(user: string) {
    return this.store.list<PlanView>(user, 'plan');
  }
  getDay(user: string, id: string) {
    const d = this.store.get<WorkoutDay & { version: number }>(
      user,
      'workout_day',
      id,
    );
    const { version, ...view } = d;
    return view;
  }
  days(user: string) {
    return this.store
      .list<WorkoutDay & { version: number }>(user, 'workout_day')
      .filter((d) => d.status === 'active')
      .map(({ version, ...d }) => d)
      .sort((a, b) => a.local_date.localeCompare(b.local_date));
  }
}
