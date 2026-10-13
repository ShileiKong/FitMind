import type {
  CommandContext,
  Memory,
  MemoryInput,
  RecordView,
  DailySummary,
} from '@fitmind/contracts';
import type { EntityStore } from '@fitmind/contracts';
import { invariant } from '../../http/errors.js';
import { resolveDate, getTimeContext } from '../time/service.js';

import { comparable } from '../workouts/recommendation.js';
export class MemoryService {
  constructor(
    private store: EntityStore,
    private s: Record<string, any>,
    private clock: () => Date,
  ) {}
  list(user: string) {
    return this.store.list<Memory>(user, 'memory').filter((m) => !m.deleted_at);
  }
  async remember(ctx: CommandContext, input: MemoryInput) {
    invariant(
      input.key?.trim() && input.value?.trim() && input.source_message_id,
      'INVALID_MEMORY',
      '记忆需要内容和来源',
    );
    return this.store.mutate(ctx, 'memory.remember', input, () => {
      const all = this.store.list<Memory>(ctx.user_id, 'memory');
      invariant(
        !all.some(
          (m) =>
            m.deleted_at &&
            m.source_ids.includes(input.source_message_id) &&
            m.key === input.key,
        ),
        'DELETED_SOURCE',
        '旧来源的记忆已删除，不能自动恢复',
      );
      const old = all.find((m) => m.key === input.key && !m.deleted_at);
      const m: Memory = {
        ...input,
        id: old?.id ?? this.store.id(),
        version: (old?.version ?? 0) + 1,
        deleted_at: null,
        source_ids: [
          ...new Set([...(old?.source_ids ?? []), input.source_message_id]),
        ],
        updated_at: ctx.now_utc,
      };
      this.store.put(ctx.user_id, 'memory', m);
      return m;
    });
  }
  async revise(
    ctx: CommandContext,
    id: string,
    version: number,
    value: string,
  ) {
    return this.store.mutate(
      ctx,
      'memory.revise:' + id,
      { version, value },
      () => {
        const m = this.store.get<Memory>(ctx.user_id, 'memory', id);
        invariant(
          m.version === version && !m.deleted_at,
          'VERSION_CONFLICT',
          '记忆已更新',
          409,
        );
        invariant(value?.trim(), 'INVALID_MEMORY', '记忆内容不能为空');
        const n = {
          ...m,
          value,
          version: m.version + 1,
          source_ids: [
            ...m.source_ids,
            ctx.source_message_id ?? ctx.request_id,
          ],
          updated_at: ctx.now_utc,
        };
        this.store.put(ctx.user_id, 'memory', n);
        return n;
      },
    );
  }
  async forget(ctx: CommandContext, id: string, version: number) {
    return this.store.mutate(ctx, 'memory.forget:' + id, { version }, () => {
      const m = this.store.get<Memory>(ctx.user_id, 'memory', id);
      invariant(m.version === version, 'VERSION_CONFLICT', '记忆已更新', 409);
      const n = { ...m, version: m.version + 1, deleted_at: ctx.now_utc };
      this.store.put(ctx.user_id, 'memory', n);
      return { id: n.id, version: n.version, deleted: true };
    });
  }
  deletedSources(user: string) {
    return this.store
      .list<Memory>(user, 'memory')
      .filter((m) => m.deleted_at)
      .flatMap((m) => m.source_ids);
  }
  /** Read one complete ledger snapshot rather than treating chat as intake. */
  async nutritionContext(user: string, date: string) {
    // Both reads execute synchronously before yielding; a concurrent edit cannot
    // make page boundaries skip food or disagree with the summary totals.
    const summaryRead: Promise<DailySummary> = this.s.summary.forDate(
      user,
      date,
    );
    const target = this.s.targets.forDate(user, date);
    const foods = this.store
      .list<RecordView>(user, 'record')
      .filter(
        (record) =>
          !record.undone_at &&
          record.kind === 'food' &&
          record.local_date === date,
      );
    const summary = await summaryRead;
    const budgets = Object.fromEntries(
      (['calories_kcal', 'carbs_g', 'protein_g', 'fat_g'] as const).map(
        (key) => {
          const value = summary[key];
          return [
            key,
            {
              ...value,
              // Partial intake gives a provisional upper allowance, not a precise balance.
              provisional_remaining:
                value.target == null
                  ? null
                  : Math.max(0, value.target - value.known_total),
              provisional_over:
                value.target == null
                  ? null
                  : Math.max(0, value.known_total - value.target),
            },
          ];
        },
      ),
    );
    return { local_date: date, target, budgets, foods };
  }
  /** Re-read the clock and dated ledger before each provider call, including recovery. */
  async dailyContext(user: string, message: any) {
    const profile = this.s.profile.get(user);
    const time = getTimeContext(this.clock, profile.timezone);
    const date = message.reference_local_date ?? time.local_date;
    const relevant = resolveDate(
      message.text?.includes('昨天') ? '昨天' : '今天',
      date,
    );
    const target = this.s.targets.forDate(user, date);
    // Start all synchronous ledger reads before yielding so totals/records agree.
    const [summary, nutrition, relevantSummary, records, currentSummary] =
      await Promise.all([
        this.s.summary.forDate(user, date),
        this.nutritionContext(user, date),
        this.s.summary.forDate(user, relevant),
        this.s.records.list(user, { local_date: relevant, limit: 30 }),
        this.s.summary.forDate(user, time.local_date),
      ]);
    return {
      current_time: time,
      message_reference_date: date,
      target,
      today_summary: summary,
      current_day_summary: currentSummary,
      nutrition_context: nutrition,
      relevant_summary: relevantSummary,
      records: records.items,
    };
  }
  async buildContext(user: string, message: any) {
    const profile = this.s.profile.get(user);
    const daily = await this.dailyContext(user, message);
    const active = message.workout_session_id
      ? this.s.workouts.get(user, message.workout_session_id)
      : message.workout_session_id === null
        ? null
        : (this.s.workouts
            .list(user)
            .find((w: any) => ['active', 'paused'].includes(w.status)) ?? null);
    const p = active?.snapshot.exercises.find(
      (e: any) => e.exercise_id === active.current_exercise_id,
    );
    const history = p
      ? this.s.workouts
          .list(user)
          .filter((w: any) => w.status === 'completed')
          .flatMap((w: any) =>
            w.snapshot.exercises
              .filter((e: any) => comparable(e, p))
              .map((e: any) => ({
                session_id: w.id,
                local_date: w.local_date,
                prescription: e,
                sets: w.sets.filter(
                  (s: any) => s.exercise_id === e.exercise_id,
                ),
              })),
          )
          .slice(0, 10)
      : [];
    return {
      ...daily,
      attachment_ids: message.attachment_ids ?? [],
      profile,
      active_workout: active,
      recent_workouts: this.s.workouts.list(user).slice(0, 10),
      recommendations: this.s.workouts
        .recommendations(user)
        .filter((r: any) => r.status === 'proposed'),
      exercise_history: history,
      plans: this.s.plans.list(user),
      memories: this.list(user),
    };
  }
}
