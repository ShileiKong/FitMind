import {
  Type,
  RecordInputSchema,
  TargetDraftSchema,
  ProposalConfirmationSchema,
  ProfilePatchSchema,
  PlanDraftSchema,
  DayInputSchema,
  WeeklyPlanSchema,
  RepeatPlanSchema,
  SetInputSchema,
  MemoryInputSchema,
  ChatRequestSchema,
  ExerciseSchema,
  type CommandContext,
  type Clock,
} from '@fitmind/contracts';
import { Value } from 'typebox/value';
import { DomainError, invariant } from '../../../api/src/http/errors';
import {
  getTimeContext,
  validateDate,
  validateTimezone,
} from '../../../api/src/modules/time/service';
import { RecordService } from '../../../api/src/modules/records/service';
import { TargetService } from '../../../api/src/modules/targets/service';
import { ProfileService } from '../../../api/src/modules/profile/service';
import { SummaryService } from '../../../api/src/modules/summary/service';
import { TrendService } from '../../../api/src/modules/trends/service';
import { PlanService } from '../../../api/src/modules/plans/service';
import { WorkoutService } from '../../../api/src/modules/workouts/service';
import { MemoryService } from '../../../api/src/modules/memory/service';
import { ReminderService } from '../../../api/src/modules/reminders/service';
import { LocalStore, canonical, type LocalBackup } from './store';

const object = (properties: any) =>
  Type.Object(properties, { additionalProperties: false });
const version = Type.Integer({ minimum: 1 });
const versionBody = object({ expected_version: version });
const patchBody = object({
  expected_version: version,
  patch: Type.Record(Type.String(), Type.Unknown()),
});
const planPatch = object({
  expected_version: version,
  patch: object({
    name: Type.Optional(Type.String()),
    days: Type.Optional(Type.Array(DayInputSchema)),
    weekly: Type.Optional(WeeklyPlanSchema),
    repeat: Type.Optional(RepeatPlanSchema),
  }),
});
const transitionBody = object({
  expected_version: version,
  action: Type.Union(
    [
      'pause',
      'resume',
      'complete',
      'abandon',
      'switch',
      'skip',
      'change_date',
    ].map((action) => Type.Literal(action)),
  ),
  exercise_id: Type.Optional(Type.String()),
  local_date: Type.Optional(Type.String()),
});
function checked(schema: any, body: any): any {
  invariant(Value.Check(schema, body), 'INVALID_INPUT', '输入格式不正确');
  return body;
}
function inputFields(value: any, names: string[]): any {
  return Object.fromEntries(
    names
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, value[key]]),
  );
}
const dayInput = (day: any) =>
  inputFields(day, ['id', 'local_date', 'name', 'exercises']);
const backupObject = (value: any) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const backupText = (value: any) =>
  typeof value === 'string' && value.length > 0;
const backupValid = (condition: unknown) =>
  invariant(condition, 'INVALID_BACKUP', '备份记录结构无效');
const timestamp = (value: any) => {
  backupValid(
    typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
        value,
      ) &&
      Number.isFinite(Date.parse(value)),
  );
  validateDate(value.slice(0, 10));
  backupValid(Number(value.slice(11, 13)) <= 23);
};
const nullableTimestamp = (value: any) => {
  if (value !== null) timestamp(value);
};
function validateResult(value: any, id: string) {
  backupValid(
    backupObject(value) &&
      value.message_id === id &&
      ['completed', 'partial', 'failed'].includes(value.status) &&
      typeof value.assistant_text === 'string',
  );
  for (const key of [
    'record_receipts',
    'proposals',
    'recommendations',
    'tool_errors',
  ])
    backupValid(Array.isArray(value[key]) && value[key].every(backupObject));
  backupValid(Array.isArray(value.affected_dates));
  value.affected_dates.forEach(validateDate);
  backupValid(value.summary === null || backupObject(value.summary));
  for (const error of [
    ...value.tool_errors,
    ...(value.error === undefined ? [] : [value.error]),
  ])
    backupValid(
      backupObject(error) &&
        backupText(error.code) &&
        typeof error.message === 'string' &&
        (error.retryable === undefined || typeof error.retryable === 'boolean'),
    );
  for (const proposal of value.proposals) {
    backupValid(
      ['target', 'plan'].includes(proposal.type) &&
        backupText(proposal.id) &&
        Number.isInteger(proposal.version) &&
        proposal.version >= 1,
    );
    if (proposal.type === 'plan') {
      backupValid(Array.isArray(proposal.days));
      checked(PlanDraftSchema, {
        name: proposal.name,
        days: proposal.days.map(dayInput),
      });
    } else
      checked(
        TargetDraftSchema,
        inputFields(proposal, [
          'effective_from',
          'effective_to',
          'allow_history',
          'water_ml',
          'calories_kcal',
          'carbs_g',
          'protein_g',
          'fat_g',
        ]),
      );
  }
}
function validateTranscript(items: any) {
  backupValid(Array.isArray(items));
  for (const item of items) {
    backupValid(
      backupObject(item) && ['user', 'assistant', 'tool'].includes(item.role),
    );
    backupValid(
      typeof item.content === 'string' ||
        (item.role === 'assistant' && item.content === null),
    );
    if (item.role === 'tool') backupValid(backupText(item.tool_call_id));
    if (item.tool_calls !== undefined) {
      backupValid(item.role === 'assistant' && Array.isArray(item.tool_calls));
      for (const call of item.tool_calls) {
        backupValid(
          backupObject(call) &&
            backupText(call.id) &&
            call.type === 'function' &&
            backupObject(call.function) &&
            backupText(call.function.name) &&
            typeof call.function.arguments === 'string',
        );
        backupValid(backupObject(JSON.parse(call.function.arguments)));
      }
    }
  }
}
function validateMessage(
  value: any,
  entity: (kind: string, id: string) => any,
) {
  checked(ChatRequestSchema, value.request);
  backupValid(
    value.request.message_id === value.id &&
      value.request.text.trim().length > 0,
  );
  timestamp(value.created_at);
  backupValid(
    ['pending', 'running', 'completed', 'partial', 'failed'].includes(
      value.status,
    ) && ['model', 'rules'].includes(value.mode),
  );
  backupValid(
    Number.isInteger(value.round) &&
      value.round >= 0 &&
      value.round <= 5 &&
      Array.isArray(value.prior_snapshot) &&
      backupObject(value.context_snapshot),
  );
  backupValid(value.imported === undefined || value.imported === true);
  if (value.result !== null) validateResult(value.result, value.id);
  if (['completed', 'partial', 'failed'].includes(value.status))
    backupValid(value.result !== null);
  if (value.imported === true) {
    // Desktop imports are immutable archives. Their original provider protocol never replays.
    backupValid(
      value.status === 'completed' &&
        value.pending === null &&
        backupObject(value.ctx) &&
        Array.isArray(value.transcript),
    );
    return;
  }
  backupValid(
    backupObject(value.ctx) &&
      value.ctx.user_id === 'personal' &&
      value.ctx.request_id === value.id &&
      value.ctx.idempotency_key === value.id &&
      value.ctx.source_message_id === value.id,
  );
  timestamp(value.ctx.now_utc);
  validateDate(value.ctx.reference_local_date);
  validateTimezone(value.ctx.timezone);
  backupValid(
    value.ctx.workout_session_id === null ||
      backupText(value.ctx.workout_session_id),
  );
  backupValid(
    value.ctx.workout_exercise_id === null ||
      backupText(value.ctx.workout_exercise_id),
  );
  if (value.ctx.workout_session_id !== null) {
    const session = entity('session', value.ctx.workout_session_id);
    backupValid(
      session &&
        (value.ctx.workout_exercise_id === null ||
          session.snapshot.exercises.some(
            (exercise: any) =>
              exercise.exercise_id === value.ctx.workout_exercise_id,
          )),
    );
  }
  validateTranscript(value.transcript);
  for (const prior of value.prior_snapshot)
    backupValid(
      backupObject(prior) &&
        backupText(prior.message_id) &&
        typeof prior.text === 'string' &&
        backupObject(prior.result) &&
        prior.result.status === 'completed' &&
        typeof prior.result.assistant_text === 'string',
    );
  for (const key of [
    'plans',
    'memories',
    'recent_workouts',
    'recommendations',
    'exercise_history',
    'records',
  ])
    if (value.context_snapshot[key] !== undefined)
      backupValid(Array.isArray(value.context_snapshot[key]));
  backupValid(value.pending === null || backupObject(value.pending));
  if (value.pending !== null) {
    backupValid(
      typeof value.pending.assistant_text === 'string' &&
        Array.isArray(value.pending.tool_calls) &&
        value.pending.tool_calls.length <= 20,
    );
    const ids = new Set<string>();
    for (const call of value.pending.tool_calls) {
      backupValid(
        backupObject(call) &&
          backupText(call.name) &&
          backupText(call.call_id) &&
          backupObject(call.arguments) &&
          !ids.has(call.call_id),
      );
      ids.add(call.call_id);
    }
    if (value.pending.response_items !== undefined)
      validateTranscript(value.pending.response_items);
  }
}

/** Portable API-compatible domain operations. Network and model calls live in LocalClient. */
export class LocalCore {
  public store: LocalStore;
  public services: {
    records: RecordService;
    targets: TargetService;
    profile: ProfileService;
    summary: SummaryService;
    trends: TrendService;
    plans: PlanService;
    workouts: WorkoutService;
    memory: MemoryService;
    reminders: ReminderService;
  };
  constructor(
    platform: any,
    private clock: Clock = () => new Date(),
  ) {
    this.store = new LocalStore(platform, clock);
    const targets = new TargetService(this.store);
    const profile = new ProfileService(this.store);
    const plans = new PlanService(this.store);
    const partial = {
      records: new RecordService(this.store),
      targets,
      profile,
      summary: new SummaryService(this.store, targets),
      trends: new TrendService(this.store),
      plans,
      workouts: new WorkoutService(this.store, plans),
      reminders: new ReminderService(this.store, plans, profile, clock),
    };
    this.services = {
      ...partial,
      memory: new MemoryService(this.store, partial, clock),
    };
  }
  context() {
    const time = getTimeContext(
      this.clock,
      this.services.profile.get('personal').timezone,
    );
    return {
      ...time,
      target: this.services.targets.forDate('personal', time.local_date),
      active_workout:
        this.services.workouts
          .list('personal')
          .find((workout) => ['active', 'paused'].includes(workout.status)) ??
        null,
    };
  }
  private command(key?: string, timezone?: string): CommandContext {
    const time = getTimeContext(
      this.clock,
      timezone ?? this.services.profile.get('personal').timezone,
    );
    return {
      user_id: 'personal',
      request_id: key ?? this.store.id(),
      idempotency_key: key ?? '',
      now_utc: time.now_utc,
      timezone: time.timezone,
      reference_local_date: time.local_date,
    };
  }
  async request(
    method: string,
    path: string,
    body?: any,
    key?: string,
  ): Promise<any> {
    const verb = method.toUpperCase();
    const [pathname, queryString = ''] = path.split('?');
    const route =
      pathname.replace(/^\/api\/v1(?=\/|$)/, '').replace(/\/$/, '') || '/';
    const query: Record<string, string> = Object.create(null);
    try {
      for (const part of queryString.split('&').filter(Boolean)) {
        const equals = part.indexOf('=');
        const name = equals < 0 ? part : part.slice(0, equals);
        const value = equals < 0 ? '' : part.slice(equals + 1);
        query[decodeURIComponent(name.replace(/\+/g, ' '))] =
          decodeURIComponent(value.replace(/\+/g, ' '));
      }
    } catch {
      throw new DomainError('INVALID_QUERY', '查询参数无效');
    }
    const segments = route
      .split('/')
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
    const s = this.services,
      user = 'personal';
    const b = body === undefined ? undefined : JSON.parse(JSON.stringify(body));
    if (verb === 'GET') {
      if (route === '/health') return { status: 'ok' };
      if (route === '/context') return this.context();
      if (route === '/profile') return s.profile.get(user);
      if (route === '/records') return s.records.list(user, query);
      if (route === '/targets') return s.targets.list(user);
      if (route === '/plans') return s.plans.list(user);
      if (route === '/workout-days') return s.plans.days(user);
      if (route === '/workout-sessions') return s.workouts.list(user);
      if (route === '/recommendations')
        return s.workouts.recommendations(user, query.session_id);
      if (route === '/memories') return s.memory.list(user);
      if (route === '/trends') return s.trends.query(user, query);
      if (route === '/reminders') return s.reminders.list(user);
      if (segments.length === 2) {
        const [kind, id] = segments;
        if (kind === 'records') return this.store.get(user, 'record', id);
        if (kind === 'plans') return s.plans.get(user, id);
        if (kind === 'workout-days') return s.plans.getDay(user, id);
        if (kind === 'workout-sessions') return s.workouts.get(user, id);
      }
      if (
        segments.length === 3 &&
        segments[0] === 'days' &&
        segments[2] === 'summary'
      )
        return s.summary.forDate(user, segments[1]);
      if (
        segments.length === 3 &&
        segments[0] === 'workout-sessions' &&
        segments[2] === 'recommendations'
      )
        return s.workouts.recommendations(user, segments[1]);
    }
    if (verb === 'PATCH' && route === '/profile') {
      checked(ProfilePatchSchema, b);
      return s.profile.update(this.command(key, b.timezone), b);
    }
    if (verb === 'POST') {
      if (route === '/records')
        return s.records.create(
          this.command(key),
          checked(RecordInputSchema, b),
        );
      if (route === '/targets/drafts')
        return s.targets.draft(
          this.command(key),
          checked(TargetDraftSchema, b),
        );
      if (route === '/plans/drafts')
        return s.plans.createDraft(
          this.command(key),
          checked(PlanDraftSchema, b),
        );
      if (route === '/workout-sessions') {
        checked(object({ workout_day_id: Type.String() }), b);
        return s.workouts.start(this.command(key), b.workout_day_id);
      }
      if (route === '/memories')
        return s.memory.remember(
          this.command(key),
          checked(MemoryInputSchema, b),
        );
      if (route === '/reminders/device-status') {
        checked(
          object({
            permission: Type.String(),
            scheduled: Type.Array(Type.String()),
            cancelled: Type.Array(Type.String()),
            failed: Type.Array(Type.String()),
            deferred: Type.Integer({ minimum: 0 }),
          }),
          b,
        );
        return s.reminders.reportDeviceStatus(this.command(key), b);
      }
      if (segments.length === 3) {
        const [kind, id, action] = segments;
        if (kind === 'records' && action === 'undo') {
          checked(versionBody, b);
          return s.records.undo(this.command(key), id, b.expected_version);
        }
        if (kind === 'targets' && action === 'confirm') {
          checked(ProposalConfirmationSchema, b);
          return s.targets.confirm(
            this.command(key),
            id,
            b.expected_version,
            b.apply_from,
          );
        }
        if (kind === 'plans' && ['confirm', 'cancel'].includes(action)) {
          checked(
            action === 'confirm' ? ProposalConfirmationSchema : versionBody,
            b,
          );
          return action === 'confirm'
            ? s.plans.confirm(
                this.command(key),
                id,
                b.expected_version,
                b.apply_from,
              )
            : s.plans.cancel(this.command(key), id, b.expected_version);
        }
        if (kind === 'workout-sessions' && action === 'sets')
          return s.workouts.recordSet(
            this.command(key),
            id,
            checked(SetInputSchema, b),
          );
        if (kind === 'workout-sessions' && action === 'transition') {
          checked(transitionBody, b);
          return s.workouts.transition(
            this.command(key),
            id,
            b.expected_version,
            b,
          );
        }
        if (kind === 'workout-sets' && action === 'undo') {
          checked(versionBody, b);
          return s.workouts.undoSet(this.command(key), id, b.expected_version);
        }
        if (kind === 'recommendations' && action === 'accept') {
          checked(versionBody, b);
          return s.workouts.acceptRecommendation(
            this.command(key),
            id,
            b.expected_version,
          );
        }
        if (kind === 'memories' && action === 'forget') {
          checked(versionBody, b);
          return s.memory.forget(this.command(key), id, b.expected_version);
        }
      }
    }
    if (verb === 'PATCH' && segments.length === 2) {
      const [kind, id] = segments;
      if (kind === 'records') {
        checked(patchBody, b);
        return s.records.edit(
          this.command(key),
          id,
          b.expected_version,
          b.patch,
        );
      }
      if (kind === 'plans') {
        checked(planPatch, b);
        return s.plans.revise(
          this.command(key),
          id,
          b.expected_version,
          b.patch,
        );
      }
      if (kind === 'workout-sets') {
        checked(patchBody, b);
        return s.workouts.editSet(
          this.command(key),
          id,
          b.expected_version,
          b.patch,
        );
      }
      if (kind === 'memories') {
        checked(
          object({
            expected_version: version,
            value: Type.String({ minLength: 1 }),
          }),
          b,
        );
        return s.memory.revise(
          this.command(key),
          id,
          b.expected_version,
          b.value,
        );
      }
    }
    throw new DomainError('NOT_FOUND', '本地接口不存在', 404);
  }
  exportBackup(): string {
    return this.store.exportBackup();
  }
  private validateBackup(text: string): LocalBackup {
    const backup = this.store.parseBackup(text);
    try {
      backupValid(
        backup.operations.every(
          (operation) => operation.user_id === 'personal',
        ),
      );
      const entity = (user: string, kind: string, id: string) =>
        backup.entities.find(
          (row) =>
            row.user_id === user && row.kind === kind && row.value.id === id,
        )?.value;
      backupValid(
        !backup.onboarding_after_message_id ||
          !!entity('personal', 'message', backup.onboarding_after_message_id),
      );
      for (const { user_id, kind, value } of backup.entities) {
        backupValid(user_id === 'personal');
        if (value.local_date !== undefined) validateDate(value.local_date);
        if (kind === 'record') {
          validateDate(value.local_date);
          const input = inputFields(value, [
            'kind',
            'amount_ml',
            'name',
            'source',
            'nutrition',
            'label',
            'assumptions',
            'attachment_ids',
            'metric',
            'value',
            'local_date',
            'occurred_at',
            'note',
          ]);
          checked(RecordInputSchema, input);
          this.services.records.validate(input);
          if (value.source === 'label')
            backupValid(
              canonical(value.nutrition) === canonical(input.nutrition),
            );
          validateTimezone(value.timezone);
          timestamp(value.recorded_at);
          nullableTimestamp(value.undone_at);
        } else if (kind === 'target') {
          checked(
            TargetDraftSchema,
            inputFields(value, [
              'effective_from',
              'effective_to',
              'allow_history',
              'water_ml',
              'calories_kcal',
              'carbs_g',
              'protein_g',
              'fat_g',
            ]),
          );
          validateDate(value.effective_from);
          if (value.effective_to) {
            validateDate(value.effective_to);
            invariant(
              value.effective_to >= value.effective_from,
              'INVALID_BACKUP',
              '目标日期范围无效',
            );
          }
          invariant(
            ['draft', 'active', 'superseded'].includes(value.status),
            'INVALID_BACKUP',
            '目标状态无效',
          );
        } else if (kind === 'profile') {
          checked(ProfilePatchSchema, {
            expected_version: value.version,
            ...inputFields(value, [
              'name',
              'timezone',
              'reminder_time',
              'notifications_enabled',
              'fitness',
              'onboarding_status',
            ]),
          });
          invariant(
            [
              'name',
              'timezone',
              'reminder_time',
              'notifications_enabled',
            ].every((key) => key in value),
            'INVALID_BACKUP',
            '资料缺少字段',
          );
          validateTimezone(value.timezone);
          if (value.onboarding_status === 'completed')
            invariant(
              value.fitness?.height_cm &&
                value.fitness.weight_kg &&
                value.fitness.goal?.trim() &&
                value.fitness.strength_training,
              'INVALID_BACKUP',
              '已完成的首次资料缺少字段',
            );
        } else if (kind === 'plan') {
          checked(PlanDraftSchema, {
            name: value.name,
            days: value.days.map(dayInput),
          });
          invariant(
            ['draft', 'active', 'cancelled'].includes(value.status),
            'INVALID_BACKUP',
            '计划状态无效',
          );
          this.services.plans.normalize(
            { days: value.days },
            value.id,
            value.version,
            value.status,
            value.days,
          );
          if (value.period !== undefined) {
            backupValid(backupObject(value.period));
            validateDate(value.period.start_date);
            validateDate(value.period.end_date);
            backupValid(
              value.period.start_date <= value.period.end_date &&
                value.days.every(
                  (day: any) =>
                    day.local_date >= value.period.start_date &&
                    day.local_date <= value.period.end_date,
                ),
            );
          }
          invariant(
            value.days.every((day: any) => {
              const persisted = entity(user_id, 'workout_day', day.id);
              return (
                persisted?.plan_id === value.id &&
                persisted?.plan_version === value.version &&
                day.plan_id === value.id &&
                day.plan_version === value.version &&
                day.status === value.status &&
                persisted.status === value.status &&
                canonical(dayInput(day)) === canonical(dayInput(persisted))
              );
            }),
            'INVALID_BACKUP',
            '计划缺少有效训练日',
          );
        } else if (kind === 'workout_day') {
          validateDate(value.local_date);
          checked(DayInputSchema, dayInput(value));
          this.services.plans.normalize(
            { days: [value] },
            value.plan_id,
            value.plan_version,
            value.status,
            [value],
          );
          invariant(
            typeof value.plan_id === 'string' &&
              Number.isInteger(value.plan_version) &&
              value.plan_version >= 1 &&
              ['draft', 'active', 'cancelled'].includes(value.status),
            'INVALID_BACKUP',
            '训练日无效',
          );
          invariant(
            entity(user_id, 'plan', value.plan_id),
            'INVALID_BACKUP',
            '训练日缺少所属计划',
          );
        } else if (kind === 'set') {
          validateDate(value.local_date);
          checked(
            SetInputSchema,
            inputFields(value, [
              'exercise_id',
              'weight_kg',
              'reps',
              'difficulty',
              'rpe',
              'pain',
              'reduce',
              'local_date',
              'occurred_at',
            ]),
          );
          this.services.workouts.validate(value);
          timestamp(value.recorded_at);
          nullableTimestamp(value.undone_at);
          invariant(
            typeof value.session_id === 'string' && value.session_id.length > 0,
            'INVALID_BACKUP',
            '训练组会话无效',
          );
          const session = entity(user_id, 'session', value.session_id);
          invariant(
            session?.snapshot?.exercises?.some(
              (exercise: any) => exercise.exercise_id === value.exercise_id,
            ),
            'INVALID_BACKUP',
            '训练组缺少所属会话动作',
          );
          backupValid(
            value.undone_at !== null || value.local_date === session.local_date,
          );
        } else if (kind === 'session') {
          validateDate(value.local_date);
          invariant(
            ['active', 'paused', 'completed', 'abandoned'].includes(
              value.status,
            ) &&
              typeof value.current_exercise_id === 'string' &&
              typeof value.workout_day_id === 'string',
            'INVALID_BACKUP',
            '训练会话无效',
          );
          checked(DayInputSchema, dayInput(value.snapshot));
          this.services.plans.normalize(
            { days: [value.snapshot] },
            value.snapshot.plan_id,
            value.snapshot.plan_version,
            'active',
            [value.snapshot],
          );
          timestamp(value.started_at);
          nullableTimestamp(value.finished_at);
          backupValid(
            ['completed', 'abandoned'].includes(value.status)
              ? value.finished_at !== null
              : value.finished_at === null,
          );
          invariant(
            Array.isArray(value.sets),
            'INVALID_BACKUP',
            '训练组列表无效',
          );
          const day = entity(user_id, 'workout_day', value.workout_day_id);
          const plan = entity(user_id, 'plan', value.snapshot.plan_id);
          backupValid(
            value.snapshot.id === value.workout_day_id &&
              value.snapshot.plan_id === day.plan_id &&
              value.snapshot.status === 'active' &&
              Number.isInteger(value.snapshot.plan_version) &&
              value.snapshot.plan_version >= 1 &&
              value.snapshot.plan_version <= plan.version &&
              value.snapshot.exercises.some(
                (exercise: any) =>
                  exercise.exercise_id === value.current_exercise_id,
              ),
          );
          invariant(
            entity(user_id, 'workout_day', value.workout_day_id) &&
              entity(user_id, 'plan', value.snapshot.plan_id),
            'INVALID_BACKUP',
            '训练会话缺少所属计划',
          );
        } else if (kind === 'memory') {
          checked(
            MemoryInputSchema,
            inputFields(value, ['key', 'value', 'source_message_id']),
          );
          invariant(
            Array.isArray(value.source_ids) &&
              value.source_ids.every((id: any) => typeof id === 'string'),
            'INVALID_BACKUP',
            '记忆来源无效',
          );
          nullableTimestamp(value.deleted_at);
        } else if (kind === 'message') {
          validateMessage(value, (kind, id) => entity(user_id, kind, id));
        } else if (kind === 'command') {
          backupValid(
            backupText(value.message_id) &&
              Number.isInteger(value.slot) &&
              value.slot >= 0 &&
              value.slot <= 99 &&
              value.id === value.message_id + ':' + value.slot &&
              typeof value.payload === 'string' &&
              'result' in value &&
              (value.result === null || backupObject(value.result)) &&
              entity(user_id, 'message', value.message_id),
          );
          const call = JSON.parse(value.payload);
          backupValid(
            backupObject(call) &&
              backupText(call.name) &&
              backupText(call.call_id) &&
              backupObject(call.arguments),
          );
          if (value.result?.tool_error !== undefined)
            backupValid(
              backupObject(value.result.tool_error) &&
                backupText(value.result.tool_error.code) &&
                typeof value.result.tool_error.message === 'string',
            );
        } else if (kind === 'recommendation') {
          backupValid(
            ['next_set', 'next_workout'].includes(value.type) &&
              ['proposed', 'paused', 'accepted', 'invalidated'].includes(
                value.status,
              ) &&
              backupText(value.reason_code) &&
              backupText(value.rule_version) &&
              Array.isArray(value.basis),
          );
          backupValid(
            value.weight_kg === null ||
              (typeof value.weight_kg === 'number' &&
                Number.isFinite(value.weight_kg) &&
                value.weight_kg >= 0),
          );
          backupValid(
            Number.isInteger(value.reps_min) &&
              value.reps_min >= 1 &&
              Number.isInteger(value.reps_max) &&
              value.reps_max >= value.reps_min &&
              value.reps_max <= 200,
          );
          const session = entity(user_id, 'session', value.session_id);
          backupValid(
            session?.snapshot?.exercises?.some(
              (exercise: any) => exercise.exercise_id === value.exercise_id,
            ),
          );
          for (const basis of value.basis)
            backupValid(
              backupObject(basis) &&
                backupText(basis.id) &&
                Number.isInteger(basis.version) &&
                basis.version >= 1 &&
                entity(user_id, 'set', basis.id)?.version >= basis.version,
            );
          if (value.type === 'next_workout') {
            checked(ExerciseSchema, value.prescription);
            const plan = entity(user_id, 'plan', value.plan_id);
            backupValid(
              plan &&
                Number.isInteger(value.plan_version) &&
                value.plan_version >= 1 &&
                value.plan_version <= plan.version &&
                value.prescription.exercise_id === value.exercise_id,
            );
          }
        }
      }
    } catch {
      throw new DomainError('INVALID_BACKUP', '备份中包含无效的业务记录');
    }
    return backup;
  }
  inspectBackup(text: string) {
    this.validateBackup(text);
    return this.store.inspectBackup(text);
  }
  importBackup(text: string) {
    this.validateBackup(text);
    return this.store.importBackup(text);
  }
}
