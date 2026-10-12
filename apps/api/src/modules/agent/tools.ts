import {
  Type,
  FoodInputSchema,
  TargetDraftSchema,
  PlanDraftSchema,
  SetInputSchema,
  NullableNumber,
  ProfilePatchSchema,
} from '@fitmind/contracts';
import { Value } from 'typebox/value';
import type { FitMindApp } from '../../app.js';
import { invariant } from '../../http/errors.js';
import { resolveDate } from '../time/service.js';
import { explicitlyApproves } from './confirmation.js';
const nullableString = Type.Union([Type.String(), Type.Null()]);
const obj = (props: any) => Type.Object(props, { additionalProperties: false });
const schemaMap: any = {
  revise_plan: obj({
    id: Type.String(),
    expected_version: Type.Integer({ minimum: 1 }),
    patch_json: Type.String(),
  }),
  cancel_plan: obj({
    id: Type.String(),
    expected_version: Type.Integer({ minimum: 1 }),
  }),
  update_profile: obj({
    expected_version: Type.Integer({ minimum: 0 }),
    patch_json: Type.String(),
  }),
  start_workout: obj({ workout_day_id: Type.String() }),
  transition_workout: obj({
    session_id: Type.String(),
    expected_version: Type.Integer({ minimum: 1 }),
    action: Type.Union(
      [
        'pause',
        'resume',
        'complete',
        'abandon',
        'switch',
        'skip',
        'change_date',
      ].map((x) => Type.Literal(x)),
    ),
    exercise_id: nullableString,
    local_date: nullableString,
  }),
  accept_recommendation: obj({
    id: Type.String(),
    expected_version: Type.Integer({ minimum: 1 }),
  }),
  revise_memory: obj({
    id: Type.String(),
    expected_version: Type.Integer({ minimum: 1 }),
    value: Type.String(),
  }),
  get_context: obj({}),
  query_history: obj({
    start_date: Type.String(),
    end_date: Type.String(),
    kind: nullableString,
    cursor: nullableString,
  }),
  query_trends: obj({
    metric: Type.String(),
    start_date: Type.String(),
    end_date: Type.String(),
    exercise_id: nullableString,
    variant: nullableString,
    equipment: nullableString,
    load_convention: nullableString,
  }),
  undo_set: obj({
    id: Type.String(),
    expected_version: Type.Integer({ minimum: 1 }),
  }),
  analyze_food_photo: obj({
    asset_id: Type.String(),
    mode: Type.Union([Type.Literal('label'), Type.Literal('meal')]),
    description: Type.String(),
  }),
  query_records: obj({
    date_expression: Type.String(),
    kind: Type.Union([
      Type.Literal('water'),
      Type.Literal('food'),
      Type.Literal('body'),
      Type.Null(),
    ]),
  }),
  record_water: obj({
    amount_ml: Type.Number({ exclusiveMinimum: 0, maximum: 20000 }),
    date_expression: Type.String(),
    note: nullableString,
  }),
  record_food: obj({ input: FoodInputSchema, date_expression: Type.String() }),
  record_body: obj({
    metric: Type.Union(
      [
        'weight_kg',
        'body_fat_percent',
        'waist_cm',
        'chest_cm',
        'hip_cm',
        'arm_cm',
      ].map((k) => Type.Literal(k)),
    ),
    value: Type.Number({ exclusiveMinimum: 0 }),
    date_expression: Type.String(),
  }),
  draft_target: obj({ input: TargetDraftSchema }),
  draft_plan: obj({ input: PlanDraftSchema }),
  confirm_proposal: obj({
    type: Type.Union([Type.Literal('target'), Type.Literal('plan')]),
    id: nullableString,
    expected_version: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  }),
  edit_record: obj({
    id: nullableString,
    expected_version: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    patch_json: Type.String(),
  }),
  undo_record: obj({
    id: Type.String(),
    expected_version: Type.Integer({ minimum: 1 }),
  }),
  record_set: obj({
    session_id: nullableString,
    exercise_id: nullableString,
    weight_kg: NullableNumber,
    reps: Type.Integer({ minimum: 0, maximum: 300 }),
    difficulty: Type.Union([
      Type.Literal('easy'),
      Type.Literal('normal'),
      Type.Literal('hard'),
      Type.Null(),
    ]),
    rpe: Type.Union([Type.Number({ minimum: 1, maximum: 10 }), Type.Null()]),
    pain: Type.Boolean(),
    reduce: Type.Boolean(),
  }),
  edit_set: obj({
    id: Type.String(),
    expected_version: Type.Integer({ minimum: 1 }),
    patch_json: Type.String(),
  }),
  remember: obj({ key: Type.String(), value: Type.String() }),
  forget_memory: obj({
    id: Type.String(),
    expected_version: Type.Integer({ minimum: 1 }),
  }),
};
const descriptions: any = {
  revise_plan:
    '用户明确要求修改现有计划时，先查最新计划版本，patch_json 为 name/days/repeat/weekly 对象。周循环可用 weekly 改整段安排；只改某一天时使用 days，保留其他日期与训练日 ID；已有实际训练快照不变。',
  cancel_plan: '用户明确取消指定计划及其未来提醒，使用最新版本。',
  update_profile:
    '保存用户明确提供或修正的姓名、时区、提醒、通知以及 fitness 基础资料（height_cm/weight_kg/sex/goal/strength_training/availability_text/limitations/equipment）、onboarding_status（in_progress/completed/skipped）。普通对话和首次引导都可使用；patch_json 只含本次明确字段，fitness 合并保留已有字段，使用资料最新版本。sex 可为 male/female/unspecified，strength_training 可为 yes/no/unsure；不猜未回答项、不重复问已有资料、不自动确认或覆盖目标/计划。',
  start_workout: '用户明确开始指定已确认训练日，保存训练会话。',
  transition_workout:
    '用户明确暂停、恢复、结束、放弃、切换、跳过或更正整场日期；疼痛可直接 pause，无需编造组数或次数。使用最新会话版本。',
  accept_recommendation:
    '仅用户明确接受已生成未来加重建议时调用；最新表现、计划与版本仍需通过校验。',
  revise_memory:
    '更正用户明确指定的长期记忆，使用最新版本和本条用户原文提供的新值。',
  query_history:
    '按明确日期范围读取真实饮水、饮食、身体历史；保留分页游标，不以聊天推断事实。',
  query_trends:
    '读取身体指标、水量、营养摄入或 workout 表现趋势，可限定动作变式、器械和重量记法。',
  undo_set: '撤销用户明确指定的实际训练组，需最新版本。',
  analyze_food_photo:
    '分析本条消息附带的图片 ID，标签是待确认草案，餐食为估算；不会写入饮食。',
  get_context: '读取服务器日期、真实目标、余额、当前训练和长期记忆。',
  query_records: '读取指定日期真实记录，今天/昨天以本消息日期为准。',
  record_water: '保存用户明确喝过的水量，毫升。',
  record_food:
    '保存尚未记录的真实饮食。有食物种类与重量/体积/数量/碗/份等依据就按常见营养估算并保存，source=estimate，assumptions 说明采用份量与主要假设；用户说不清楚或让AI估算时采用常见份量，不索要热量、宏量或反复问碗大小。两份合计500g按总量500g，每份500g才乘2。真实标签用 source=label 按实际食用量换算；确实未知的营养填 null。已有同一次摄入用 edit_record 更正，不重记已保存水和食物；仅种类或实际摄入确有歧义才澄清一个关键问题。',
  record_body: '保存用户明确提供的身体指标，kg/cm/%。',
  draft_target: '创建目标草案；只在用户确认后生效。',
  draft_plan:
    '创建计划草案。多周重复安排优先使用 input.weekly 的起止日期和每个 weekday 的不同动作，只定义一周；0=周日，1=周一，…6=周六。weekly、repeat、days 三选一；有分阶段差异时保留按日期安排，未知重量或增量填 null。',
  confirm_proposal: '用户明确确认且草案唯一或通过 UI 指定时才确认。',
  edit_record:
    '更正唯一指定记录，patch_json 为合法的 JSON 对象。无法定位时先询问。',
  undo_record: '撤销指定记录。',
  record_set:
    '记录实际训练组，未提及实际重量填 null；session/exercise 为 null 时采用活动训练动作。',
  edit_set: '更正实际训练组，patch_json 为字段 JSON。',
  remember:
    '保存用户本次原文明示的稳定偏好、可用器械、限制等长期事实，无需说记住；不保存推测、临时摄入或 AI 建议。',
  forget_memory: '删除用户指定的记忆。',
};
// Strict model schemas require every property; optional fields are nullable on the wire.
export function strictSchema(s: any): any {
  const v = JSON.parse(JSON.stringify(s));
  if (v.properties) {
    const required = new Set(v.required ?? []);
    for (const [k, p] of Object.entries(v.properties)) {
      v.properties[k] = strictSchema(p);
      if (!required.has(k))
        v.properties[k] = { anyOf: [v.properties[k], { type: 'null' }] };
    }
    v.required = Object.keys(v.properties);
    v.additionalProperties = false;
  }
  if (v.items) v.items = strictSchema(v.items);
  for (const k of ['anyOf', 'oneOf', 'allOf'])
    if (v[k]) v[k] = v[k].map(strictSchema);
  return v;
}
function normalize(value: any, s: any): any {
  if (!s || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => normalize(v, s.items));
  const required = new Set(s.required ?? []);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([k, v]) => v !== null || required.has(k))
      .map(([k, v]) => [k, normalize(v, s.properties?.[k])]),
  );
}
export const agentTools = Object.entries(schemaMap).map(([name, s]) => ({
  name,
  description: descriptions[name],
  parameters: strictSchema(s),
}));
function valid(schema: any, value: any): boolean {
  return Value.Check(schema, value);
}
export async function executeTool(
  app: FitMindApp,
  ctx: any,
  request: any,
  name: string,
  args: any,
) {
  const s = app.services;
  invariant(schemaMap[name], 'UNKNOWN_TOOL', '未知工具');
  const a = normalize(args, schemaMap[name]);
  invariant(
    valid(schemaMap[name], a),
    'INVALID_TOOL_ARGUMENTS',
    '工具参数无效，请补全或明确输入',
  );
  const date = (expr: string) => resolveDate(expr, ctx.reference_local_date);
  switch (name) {
    case 'revise_plan':
      return s.plans.revise(
        ctx,
        a.id,
        a.expected_version,
        JSON.parse(a.patch_json),
      );
    case 'cancel_plan':
      return s.plans.cancel(ctx, a.id, a.expected_version);
    case 'update_profile': {
      const patch = {
        ...JSON.parse(a.patch_json),
        expected_version: a.expected_version,
      };
      invariant(
        Value.Check(ProfilePatchSchema, patch),
        'INVALID_TOOL_ARGUMENTS',
        '资料修改字段无效',
      );
      return s.profile.update(ctx, patch);
    }
    case 'start_workout':
      return s.workouts.start(ctx, a.workout_day_id);
    case 'transition_workout':
      return s.workouts.transition(ctx, a.session_id, a.expected_version, {
        action: a.action,
        ...(a.exercise_id ? { exercise_id: a.exercise_id } : {}),
        ...(a.local_date ? { local_date: date(a.local_date) } : {}),
      });
    case 'accept_recommendation':
      invariant(
        explicitlyApproves(request.text, 'recommendation'),
        'CONFIRMATION_REQUIRED',
        '未来加重需用户明确接受',
      );
      return s.workouts.acceptRecommendation(ctx, a.id, a.expected_version);
    case 'revise_memory':
      invariant(
        request.text.includes(a.value),
        'MEMORY_SOURCE_REQUIRED',
        '只使用用户本条提供的新记忆内容',
      );
      return s.memory.revise(ctx, a.id, a.expected_version, a.value);
    case 'get_context':
      return s.memory.buildContext(ctx.user_id, {
        ...request,
        reference_local_date: ctx.reference_local_date,
        workout_session_id: ctx.workout_session_id,
      });
    case 'analyze_food_photo':
      invariant(
        request.attachment_ids?.includes(a.asset_id),
        'ATTACHMENT_REQUIRED',
        '仅可解析本消息附带的图片',
      );
      return s.nutrition.analyze(ctx, a);
    case 'query_records':
      return s.records.list(ctx.user_id, {
        local_date: date(a.date_expression),
        kind: a.kind ?? undefined,
        limit: 100,
      });
    case 'query_history':
      return s.records.list(ctx.user_id, {
        start_date: date(a.start_date),
        end_date: date(a.end_date),
        kind: a.kind ?? undefined,
        cursor: a.cursor ?? undefined,
        limit: 100,
      });
    case 'query_trends':
      return s.trends.query(ctx.user_id, {
        ...a,
        start_date: date(a.start_date),
        end_date: date(a.end_date),
      });
    case 'undo_set':
      return s.workouts.undoSet(ctx, a.id, a.expected_version);
    case 'record_water':
      return s.records.create(ctx, {
        kind: 'water',
        amount_ml: a.amount_ml,
        local_date: date(a.date_expression),
        ...(a.note ? { note: a.note } : {}),
      });
    case 'record_food':
      invariant(
        a.input.source !== 'estimate' || a.input.assumptions?.trim(),
        'PORTION_REQUIRED',
        '估算记录需要说明食物份量与假设',
      );
      return s.records.create(ctx, {
        ...a.input,
        local_date: date(a.date_expression),
      });
    case 'record_body':
      return s.records.create(ctx, {
        kind: 'body',
        metric: a.metric,
        value: a.value,
        local_date: date(a.date_expression),
      });
    case 'draft_target':
      return s.targets.draft(ctx, a.input);
    case 'draft_plan':
      return s.plans.createDraft(ctx, a.input);
    case 'confirm_proposal': {
      invariant(
        request.confirmation || explicitlyApproves(request.text, 'proposal'),
        'CONFIRMATION_REQUIRED',
        '目标和计划需用户明确确认',
      );
      let proposed = request.confirmation;
      if (!proposed) {
        const all = [
          ...s.targets
            .list(ctx.user_id)
            .filter((x: any) => x.status === 'draft')
            .map((x: any) => ({ ...x, type: 'target' })),
          ...s.plans
            .list(ctx.user_id)
            .filter((x: any) => x.status === 'draft')
            .map((x: any) => ({ ...x, type: 'plan' })),
        ];
        invariant(
          all.length === 1,
          'AMBIGUOUS_PROPOSAL',
          '有多个草案，请明确要确认的草案',
        );
        proposed = {
          id: all[0].id,
          type: all[0].type,
          expected_version: all[0].version,
        };
      }
      invariant(
        a.id === proposed.id &&
          a.type === proposed.type &&
          a.expected_version === proposed.expected_version,
        'PROPOSAL_MISMATCH',
        '确认对象不一致',
      );
      return s[a.type === 'target' ? 'targets' : 'plans'].confirm(
        ctx,
        a.id,
        a.expected_version,
      );
    }
    case 'edit_record':
      invariant(
        a.id && a.expected_version,
        'AMBIGUOUS_RECORD',
        '请明确要修改哪条记录',
      );
      return s.records.edit(
        ctx,
        a.id,
        a.expected_version,
        JSON.parse(a.patch_json),
      );
    case 'undo_record':
      return s.records.undo(ctx, a.id, a.expected_version);
    case 'record_set': {
      const session_id = a.session_id ?? ctx.workout_session_id;
      invariant(
        ctx.workout_session_id === undefined ||
          session_id === ctx.workout_session_id,
        'WORKOUT_CONTEXT_CONFLICT',
        '请核对本条消息对应的训练会话',
      );
      const w = session_id
        ? s.workouts.get(ctx.user_id, session_id)
        : ctx.workout_session_id === null
          ? null
          : s.workouts
              .list(ctx.user_id)
              .find((w: any) => w.status === 'active');
      invariant(w, 'NO_ACTIVE_WORKOUT', '请先开始或恢复训练');
      return s.workouts.recordSet(ctx, w.id, {
        exercise_id:
          a.exercise_id ?? ctx.workout_exercise_id ?? w.current_exercise_id,
        weight_kg: a.weight_kg,
        reps: a.reps,
        difficulty: a.difficulty,
        rpe: a.rpe,
        pain: a.pain,
        reduce: a.reduce,
      });
    }
    case 'edit_set':
      return s.workouts.editSet(
        ctx,
        a.id,
        a.expected_version,
        JSON.parse(a.patch_json),
      );
    case 'remember':
      invariant(
        a.value.trim() && request.text.includes(a.value),
        'MEMORY_SOURCE_REQUIRED',
        '只记录用户本次明确提供的长期事实',
      );
      return s.memory.remember(ctx, {
        key: a.key,
        value: a.value,
        source_message_id: request.message_id,
      });
    case 'forget_memory':
      return s.memory.forget(ctx, a.id, a.expected_version);
  }
}
