import type {
  CommandContext,
  WorkoutSession,
  WorkoutSet,
  WorkoutSetInput,
  Recommendation,
} from '@fitmind/contracts';
import type { EntityStore } from '@fitmind/contracts';
import { PlanService } from '../plans/service.js';
import { invariant } from '../../http/errors.js';
import { validateDate } from '../time/service.js';
import {
  recommendNextSet,
  recommendNextWorkout,
  comparable,
} from './recommendation.js';
export class WorkoutService {
  constructor(
    private store: EntityStore,
    private plans: PlanService,
  ) {}
  list(user: string) {
    return this.store
      .list<WorkoutSession>(user, 'session')
      .map((w) => this.get(user, w.id));
  }
  get(user: string, id: string): WorkoutSession {
    const w = this.store.get<WorkoutSession>(user, 'session', id);
    return {
      ...w,
      sets: this.store
        .list<WorkoutSet>(user, 'set')
        .filter((s) => s.session_id === id && !s.undone_at)
        .reverse(),
    };
  }
  async start(ctx: CommandContext, day_id: string) {
    return this.store.mutate(ctx, 'workout.start', { day_id }, () => {
      const day = this.plans.getDay(ctx.user_id, day_id);
      invariant(day.status === 'active', 'PLAN_INACTIVE', '需要先确认有效计划');
      const active = this.list(ctx.user_id).find((w) =>
        ['active', 'paused'].includes(w.status),
      );
      if (active) {
        invariant(
          active.workout_day_id === day_id,
          'ACTIVE_SESSION',
          '请先结束当前训练',
          409,
        );
        return active;
      }
      const existing = this.list(ctx.user_id).find(
        (w) => w.workout_day_id === day_id && w.status === 'completed',
      );
      invariant(!existing, 'DAY_COMPLETED', '该训练日已经完成', 409);
      const w: WorkoutSession = {
        id: this.store.id(),
        version: 1,
        workout_day_id: day_id,
        local_date: ctx.reference_local_date,
        status: 'active',
        current_exercise_id: day.exercises[0].exercise_id,
        snapshot: day,
        started_at: ctx.now_utc,
        finished_at: null,
        sets: [],
      };
      this.store.put(ctx.user_id, 'session', w);
      return w;
    });
  }
  validate(input: WorkoutSetInput) {
    invariant(
      Number.isInteger(input.reps) && input.reps >= 0 && input.reps <= 300,
      'INVALID_REPS',
      '实际次数须为 0 至 300 的整数',
    );
    invariant(
      input.weight_kg == null ||
        (Number.isFinite(input.weight_kg) &&
          input.weight_kg >= 0 &&
          input.weight_kg <= 2000),
      'INVALID_LOAD',
      '实际重量无效',
    );
    invariant(
      input.rpe == null ||
        (Number.isFinite(input.rpe) && input.rpe >= 1 && input.rpe <= 10),
      'INVALID_RPE',
      'RPE 范围为 1 至 10',
    );
    invariant(
      input.difficulty == null ||
        ['easy', 'normal', 'hard'].includes(input.difficulty),
      'INVALID_DIFFICULTY',
      '难度无效',
    );
  }
  async recordSet(ctx: CommandContext, id: string, input: WorkoutSetInput) {
    this.validate(input);
    return this.store.mutate(ctx, 'workout.set:' + id, input, () => {
      const w = this.get(ctx.user_id, id);
      invariant(
        w.status === 'active',
        'SESSION_INACTIVE',
        '请恢复正在进行的训练',
      );
      const p = w.snapshot.exercises.find(
        (e) => e.exercise_id === input.exercise_id,
      );
      invariant(p, 'UNKNOWN_EXERCISE', '动作不在当前训练中');
      const s: WorkoutSet = {
        ...input,
        id: this.store.id(),
        version: 1,
        session_id: id,
        weight_kg: input.weight_kg ?? null,
        local_date: w.local_date,
        occurred_at: input.occurred_at ?? null,
        recorded_at: ctx.now_utc,
        undone_at: null,
      };
      this.store.put(ctx.user_id, 'set', s);
      this.invalidateMovement(ctx.user_id, p);
      const reco = {
        ...recommendNextSet({ prescription: p, actual: s }),
        id: this.store.id(),
        version: 1,
        session_id: id,
        exercise_id: p.exercise_id,
        type: 'next_set',
      };
      this.store.put(ctx.user_id, 'recommendation', reco);
      const total =
        w.sets.filter((x) => x.exercise_id === p.exercise_id).length + 1;
      const index = w.snapshot.exercises.findIndex(
        (e) => e.exercise_id === p.exercise_id,
      );
      const current =
        total >= p.sets
          ? (w.snapshot.exercises[index + 1]?.exercise_id ?? p.exercise_id)
          : p.exercise_id;
      const session = {
        ...w,
        version: w.version + 1,
        current_exercise_id: current,
        status: input.pain ? ('paused' as const) : w.status,
        sets: [],
      };
      this.store.put(ctx.user_id, 'session', session);
      return {
        session: this.get(ctx.user_id, id),
        set: s,
        recommendation: reco,
      };
    });
  }
  async transition(
    ctx: CommandContext,
    id: string,
    version: number,
    input: any,
  ) {
    return this.store.mutate(
      ctx,
      'workout.transition:' + id,
      { version, input },
      () => {
        const w = this.get(ctx.user_id, id);
        invariant(
          w.version === version,
          'VERSION_CONFLICT',
          '训练状态已更新',
          409,
        );
        if (input.action === 'change_date') {
          const local_date = validateDate(input.local_date);
          for (const set of w.sets) {
            this.store.put(ctx.user_id, 'set', {
              ...set,
              local_date,
              version: set.version + 1,
            });
            this.invalidate(ctx.user_id, set.id);
          }
          const next = { ...w, sets: [], local_date, version: w.version + 1 };
          this.store.put(ctx.user_id, 'session', next);
          this.recompute(ctx, id);
          return this.get(ctx.user_id, id);
        }
        invariant(
          ['active', 'paused'].includes(w.status),
          'SESSION_FINISHED',
          '训练已经结束',
        );
        const actions: Record<string, WorkoutSession['status']> = {
          pause: 'paused',
          resume: 'active',
          complete: 'completed',
          abandon: 'abandoned',
          switch: w.status,
          skip: w.status,
        };
        invariant(actions[input.action], 'INVALID_ACTION', '训练操作无效');
        let current = w.current_exercise_id;
        if (input.action === 'switch') {
          invariant(
            w.snapshot.exercises.some(
              (e) => e.exercise_id === input.exercise_id,
            ),
            'UNKNOWN_EXERCISE',
            '动作无效',
          );
          current = input.exercise_id;
        }
        if (input.action === 'skip') {
          const idx = w.snapshot.exercises.findIndex(
            (e) => e.exercise_id === current,
          );
          current = w.snapshot.exercises[idx + 1]?.exercise_id ?? current;
        }
        const next = {
          ...w,
          sets: [],
          version: w.version + 1,
          status: actions[input.action],
          current_exercise_id: current,
          finished_at: ['complete', 'abandon'].includes(input.action)
            ? ctx.now_utc
            : null,
        };
        this.store.put(ctx.user_id, 'session', next);
        if (input.action === 'complete')
          this.propose(ctx, this.get(ctx.user_id, id));
        return this.get(ctx.user_id, id);
      },
    );
  }
  propose(ctx: CommandContext, w: WorkoutSession) {
    for (const p of w.snapshot.exercises) {
      this.invalidateMovement(ctx.user_id, p);
      const comparableHistory = this.history(ctx.user_id, p);
      const r = recommendNextWorkout(comparableHistory, p);
      if (r.reason_code === 'TWO_SUCCESSES')
        this.store.put(ctx.user_id, 'recommendation', {
          ...r,
          id: this.store.id(),
          version: 1,
          session_id: w.id,
          exercise_id: p.exercise_id,
          prescription: p,
          type: 'next_workout',
          plan_id: w.snapshot.plan_id,
          plan_version: this.plans.get(ctx.user_id, w.snapshot.plan_id).version,
        });
    }
  }
  private history(user: string, p: any) {
    return this.list(user)
      .filter((w) => w.status === 'completed')
      .sort(
        (a, b) =>
          (b.finished_at ?? '').localeCompare(a.finished_at ?? '') ||
          b.started_at.localeCompare(a.started_at),
      )
      .flatMap((w) =>
        w.snapshot.exercises
          .filter((e) => comparable(e, p))
          .map((e) => ({
            session_id: w.id,
            prescription: e,
            sets: w.sets.filter((s) => s.exercise_id === e.exercise_id),
          })),
      );
  }
  private invalidateMovement(user: string, p: any) {
    for (const r of this.recommendations(user))
      if (
        r.type === 'next_workout' &&
        r.status === 'proposed' &&
        comparable(r.prescription, p)
      )
        this.store.put(user, 'recommendation', {
          ...r,
          status: 'invalidated',
          version: r.version + 1,
        });
  }
  recommendations(user: string, session?: string) {
    return this.store
      .list<any>(user, 'recommendation')
      .filter((r) => !session || r.session_id === session);
  }
  invalidate(user: string, set_id: string) {
    for (const r of this.recommendations(user))
      if (r.basis.some((b: any) => b.id === set_id))
        this.store.put(user, 'recommendation', {
          ...r,
          status: 'invalidated',
          version: r.version + 1,
        });
  }
  recompute(ctx: CommandContext, session_id: string) {
    const w = this.get(ctx.user_id, session_id);
    for (const p of w.snapshot.exercises) {
      const last = w.sets.filter((s) => s.exercise_id === p.exercise_id).at(-1);
      if (last)
        this.store.put(ctx.user_id, 'recommendation', {
          ...recommendNextSet({ prescription: p, actual: last }),
          id: this.store.id(),
          version: 1,
          session_id,
          exercise_id: p.exercise_id,
          type: 'next_set',
        });
    }
    if (w.status === 'completed') this.propose(ctx, w);
  }
  async editSet(ctx: CommandContext, id: string, version: number, patch: any) {
    return this.store.mutate(ctx, 'set.edit:' + id, { version, patch }, () => {
      const s = this.store.get<WorkoutSet>(ctx.user_id, 'set', id);
      invariant(
        s.version === version && !s.undone_at,
        'VERSION_CONFLICT',
        '组记录已更新或撤销',
        409,
      );
      invariant(
        Object.keys(patch).every((k) =>
          [
            'weight_kg',
            'reps',
            'difficulty',
            'rpe',
            'pain',
            'occurred_at',
          ].includes(k),
        ),
        'INVALID_PATCH',
        '组修改字段无效',
      );
      const next = { ...s, ...patch, version: s.version + 1 };
      this.validate(next);
      this.store.put(ctx.user_id, 'set', next);
      this.invalidate(ctx.user_id, id);
      this.recompute(ctx, next.session_id);
      return next;
    });
  }
  async undoSet(ctx: CommandContext, id: string, version: number) {
    return this.store.mutate(ctx, 'set.undo:' + id, { version }, () => {
      const s = this.store.get<WorkoutSet>(ctx.user_id, 'set', id);
      invariant(s.version === version, 'VERSION_CONFLICT', '组记录已更新', 409);
      const next = { ...s, version: s.version + 1, undone_at: ctx.now_utc };
      this.store.put(ctx.user_id, 'set', next);
      this.invalidate(ctx.user_id, id);
      this.recompute(ctx, next.session_id);
      return next;
    });
  }
  async acceptRecommendation(ctx: CommandContext, id: string, version: number) {
    return this.store.mutate(
      ctx,
      'recommendation.accept:' + id,
      { version },
      () => {
        const r = this.store.get<any>(ctx.user_id, 'recommendation', id);
        invariant(
          r.version === version &&
            r.status === 'proposed' &&
            r.type === 'next_workout',
          'STALE_RECOMMENDATION',
          '建议已过期或不是未来训练建议',
          409,
        );
        for (const b of r.basis) {
          const s = this.store.get<WorkoutSet>(ctx.user_id, 'set', b.id);
          invariant(
            !s.undone_at && s.version === b.version,
            'STALE_RECOMMENDATION',
            '建议依据已更新',
            409,
          );
        }
        const plan = this.plans.get(ctx.user_id, r.plan_id);
        const current = recommendNextWorkout(
          this.history(ctx.user_id, r.prescription),
          r.prescription,
        );
        invariant(
          plan.version === r.plan_version &&
            current.reason_code === 'TWO_SUCCESSES' &&
            current.weight_kg === r.weight_kg &&
            JSON.stringify(current.basis) === JSON.stringify(r.basis),
          'STALE_RECOMMENDATION',
          '最新训练表现或计划已更新，请重新生成建议',
          409,
        );
        invariant(
          plan.status === 'active' &&
            plan.days.some(
              (d) =>
                d.local_date > ctx.reference_local_date &&
                d.exercises.some((p) => comparable(p, r.prescription)),
            ),
          'NO_FUTURE_DAY',
          '需要有效的未来同动作训练日',
        );
        const days = plan.days.map((d) => ({
          id: d.id,
          name: d.name,
          local_date: d.local_date,
          exercises: d.exercises.map((p) =>
            d.local_date > ctx.reference_local_date &&
            comparable(p, r.prescription)
              ? { ...p, weight_kg: r.weight_kg }
              : p,
          ),
        }));
        const updated = this.plans.revise(
          {
            ...ctx,
            idempotency_key: ctx.idempotency_key + ':plan',
            journal: undefined,
          } as CommandContext,
          plan.id,
          plan.version,
          { days },
        );
        const accepted = { ...r, status: 'accepted', version: r.version + 1 };
        this.store.put(ctx.user_id, 'recommendation', accepted);
        return { recommendation: accepted, plan: updated };
      },
    );
  }
}
