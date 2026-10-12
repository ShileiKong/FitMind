import {
  ChatRequestSchema,
  type ChatRequest,
  type ChatResult,
  type CommandContext,
} from '@fitmind/contracts';
import { Value } from 'typebox/value';
import { planOverview } from '@fitmind/contracts/plan-overview';
import { DomainError, invariant } from '../../../api/src/http/errors';
import { agentTools, executeTool } from '../../../api/src/modules/agent/tools';
import { coachPrompt } from '../../../api/src/modules/agent/prompts';
import { resolveReferenceDate } from '../../../api/src/modules/time/service';
import type { ProviderStep, ToolCall } from '../../../api/src/providers/types';
import type { LocalCore } from './core';
import {
  DeepSeekClient,
  defaultModel,
  modelStorageKey,
  type ModelSettings,
} from './model';

const user = 'personal';
/** A lossless weekly view avoids repeating the same prescription for every date. */
function compactPlan(plan: any) {
  if (!Array.isArray(plan?.days)) return plan;
  const overview = planOverview(plan);
  if (!overview.weekly.length) return plan;
  const { days, ...meta } = plan;
  return {
    ...meta,
    period: overview.period,
    weekly_blocks: overview.weekly.map((block) => ({
      weekday: block.weekday,
      start_date: block.start_date,
      end_date: block.end_date,
      name: block.days[0].name,
      exercises: block.days[0].exercises,
      days: block.days.map((day) => {
        const { exercises, ...fields } = day;
        return {
          ...fields,
          exercise_ids: exercises.map((exercise) => exercise.exercise_id),
        };
      }),
    })),
    single_days: overview.single,
  };
}
function compactContext(context: any) {
  return { ...context, plans: (context.plans ?? []).map(compactPlan) };
}
function canonical(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'null';
}
interface Message {
  id: string;
  version: number;
  created_at: string;
  request: ChatRequest;
  ctx: CommandContext;
  context_snapshot: any;
  prior_snapshot: any[];
  transcript: any[];
  round: number;
  pending: ProviderStep | null;
  status: 'pending' | 'running' | 'completed' | 'partial' | 'failed';
  result: ChatResult | null;
  mode: 'model' | 'rules';
}

export class LocalAgent {
  private active = new Map<string, Promise<ChatResult>>();
  private starting = new Map<string, Promise<ChatResult>>();
  constructor(
    private core: LocalCore,
    private platform: any,
    private clock = () => new Date(),
  ) {}

  get modelSettings(): ModelSettings {
    const value = this.platform.getStorageSync(modelStorageKey);
    if (value == null || value === '')
      return { api_key: '', model: defaultModel };
    invariant(
      value &&
        typeof value.api_key === 'string' &&
        typeof value.model === 'string',
      'MODEL_SETTINGS_CORRUPT',
      'AI 设置损坏，请重新配置',
    );
    return { api_key: value.api_key, model: value.model || defaultModel };
  }
  saveModel(input: ModelSettings) {
    invariant(
      typeof input?.api_key === 'string' && typeof input?.model === 'string',
      'INVALID_MODEL_SETTINGS',
      '请填写有效 AI 设置',
    );
    const api_key = input.api_key.trim(),
      model = input.model.trim() || defaultModel;
    invariant(
      api_key.length > 0 && api_key.length <= 512 && !/\s/.test(api_key),
      'INVALID_API_KEY',
      '请填写有效 API Key',
    );
    invariant(
      /^[a-zA-Z0-9_.-]{1,100}$/.test(model),
      'INVALID_MODEL',
      '请填写有效模型名',
    );
    this.platform.setStorageSync(modelStorageKey, { api_key, model });
  }
  clearModel() {
    this.platform.removeStorageSync(modelStorageKey);
  }
  async testModel() {
    await new DeepSeekClient(this.platform, this.modelSettings).next({
      instructions: '用中文回复“连接成功”。',
      transcript: [{ role: 'user', content: '测试连接' }],
      tools: [],
    });
  }

  messages(conversation = 'main') {
    const deleted = new Set(this.core.services.memory.deletedSources(user));
    return this.core.store
      .list<Message>(user, 'message')
      .filter(
        (m) => m.request.conversation_id === conversation && !deleted.has(m.id),
      )
      .slice(0, 50)
      .reverse()
      .map((m) => ({
        message_id: m.id,
        text: m.request.text,
        result: m.result,
        status: m.status,
        created_at: m.created_at,
      }));
  }
  get(id: string) {
    const message = this.core.store.get<Message>(user, 'message', id);
    return message.result ?? { message_id: id, status: message.status };
  }
  async run(request: ChatRequest): Promise<ChatResult> {
    invariant(
      Value.Check(ChatRequestSchema, request) && request.text?.trim(),
      'INVALID_MESSAGE',
      '请填写有效消息',
    );
    const prior = this.core.store
      .list<Message>(user, 'message')
      .find((m) => m.id === request.message_id);
    if (prior) {
      invariant(
        canonical(prior.request) === canonical(request),
        'MESSAGE_CONFLICT',
        '同一消息 ID 已用于不同内容',
        409,
      );
      return this.recover(prior.id);
    }
    if (this.starting.has(request.message_id)) {
      // An initial context read is asynchronous; reject a conflicting caller during it.
      const pending = this.starting.get(request.message_id)!;
      return pending.then(() => this.run(request));
    }
    const pending = this.create(request);
    this.starting.set(request.message_id, pending);
    return pending.finally(() => this.starting.delete(request.message_id));
  }
  private async create(request: ChatRequest) {
    invariant(
      !request.attachment_ids?.length,
      'MEDIA_UNSUPPORTED',
      '当前本地版支持文字，请填写食物和份量',
    );
    const time = this.core.context();
    const w = request.workout_session_id
      ? this.core.services.workouts.get(user, request.workout_session_id)
      : request.workout_session_id === null
        ? null
        : this.core.services.workouts
            .list(user)
            .find((w: any) => ['active', 'paused'].includes(w.status));
    const ctx: CommandContext = {
      user_id: user,
      request_id: request.message_id,
      idempotency_key: request.message_id,
      now_utc: this.clock().toISOString(),
      timezone: time.timezone,
      reference_local_date: resolveReferenceDate(request, time),
      source_message_id: request.message_id,
      workout_session_id: w?.id ?? null,
      workout_exercise_id:
        request.workout_exercise_id ?? w?.current_exercise_id ?? null,
    };
    const prior_snapshot = this.messages(request.conversation_id)
      .filter((m) => m.result?.status === 'completed')
      .slice(-8)
      .map((m) => ({
        message_id: m.message_id,
        text: m.text,
        result: {
          status: m.result!.status,
          assistant_text: m.result!.assistant_text,
        },
      }));
    const context_snapshot = compactContext(
      await this.core.services.memory.buildContext(user, {
        ...request,
        reference_local_date: ctx.reference_local_date,
        workout_session_id: ctx.workout_session_id,
      }),
    );
    const message: Message = {
      id: request.message_id,
      version: 1,
      created_at: ctx.now_utc,
      request: JSON.parse(JSON.stringify(request)),
      ctx,
      context_snapshot,
      prior_snapshot,
      transcript: [{ role: 'user', content: request.text }],
      round: 0,
      pending: null,
      status: 'pending',
      result: null,
      mode: this.modelSettings.api_key ? 'model' : 'rules',
    };
    this.core.store.transaction(() =>
      this.core.store.put(user, 'message', message),
    );
    return this.recover(message.id);
  }
  recover(id: string): Promise<ChatResult> {
    const message = this.core.store.get<Message>(user, 'message', id);
    if (message.status === 'completed') return Promise.resolve(message.result!);
    if (this.active.has(id)) return this.active.get(id)!;
    const pending = this.execute(message);
    this.active.set(id, pending);
    return pending.finally(() => this.active.delete(id));
  }
  private save(message: Message) {
    message.version++;
    this.core.store.transaction(() =>
      this.core.store.put(user, 'message', message),
    );
  }
  private commands(id: string): any[] {
    return this.core.store
      .list<any>(user, 'command')
      .filter((c) => c.message_id === id)
      .sort((a, b) => a.slot - b.slot);
  }
  private filterDeleted(value: any, deleted: Set<string>): any {
    if (Array.isArray(value))
      return value
        .filter(
          (entry) =>
            !(
              Array.isArray(entry?.source_ids) &&
              entry.source_ids.some((id: string) => deleted.has(id))
            ),
        )
        .map((entry) => this.filterDeleted(entry, deleted));
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          this.filterDeleted(entry, deleted),
        ]),
      );
    return value;
  }
  private modelInput(message: Message) {
    const deleted = new Set(this.core.services.memory.deletedSources(user));
    invariant(
      !deleted.has(message.id),
      'DELETED_SOURCE',
      '这条消息的记忆来源已删除，请用新消息继续',
      409,
    );
    const prior = message.prior_snapshot
      .filter((m) => !deleted.has(m.message_id))
      .flatMap((m) => [
        { role: 'user', content: m.text },
        { role: 'assistant', content: m.result.assistant_text },
      ]);
    const transcript = message.transcript.map((m) => {
      if (m.role !== 'tool') return m;
      try {
        return {
          ...m,
          content: JSON.stringify(
            this.filterDeleted(JSON.parse(m.content), deleted),
          ),
        };
      } catch {
        return m;
      }
    });
    return {
      instructions:
        coachPrompt.replace('服务器当前时间', '设备当前时间') +
        '\n手机本地版仅支持文字。计划的weekly_blocks使用一份动作模板，days保存每个日期、训练日ID与按模板顺序对应的exercise_ids；single_days保存独立安排。修改需保留其他日期和差异。当前真实状态：' +
        JSON.stringify(this.filterDeleted(message.context_snapshot, deleted)),
      transcript: [...prior, ...transcript],
      tools:
        message.round >= 5
          ? []
          : agentTools.filter((t) => t.name !== 'analyze_food_photo'),
    };
  }
  private async callTool(message: Message, call: ToolCall, slot: number) {
    const payload = canonical(call),
      existing = this.commands(message.id).find((c) => c.slot === slot);
    if (existing) {
      invariant(
        existing.payload === payload,
        'COMMAND_CONFLICT',
        '恢复的工具内容不一致',
        409,
      );
      return existing.result;
    }
    const ctx = {
      ...message.ctx,
      idempotency_key: message.id + ':' + slot,
      journal: { message_id: message.id, slot, payload },
    };
    let output: any;
    try {
      invariant(
        call.name !== 'analyze_food_photo',
        'MEDIA_UNSUPPORTED',
        '请使用文字填写食物和份量',
      );
      output = await executeTool(
        { services: this.core.services } as unknown as Parameters<
          typeof executeTool
        >[0],
        ctx,
        message.request,
        call.name,
        call.arguments,
      );
      if (call.name === 'get_context') output = compactContext(output);
    } catch (error: any) {
      // Storage failures remain recoverable: never claim a rolled-back write succeeded.
      if (
        error.code?.startsWith('STORAGE') ||
        error.code === 'LOCAL_DATA_CORRUPT'
      )
        throw error;
      output = {
        tool_error: {
          code: error.code ?? 'TOOL_ERROR',
          message:
            error instanceof DomainError ? error.message : '工具参数或操作无效',
        },
      };
    }
    // Mutation services already journaled their output in the same transaction.
    // Read-only results and rejected tools have no side effect and can be journaled now.
    this.core.store.transaction(() =>
      this.core.store.journal(ctx, output ?? null),
    );
    return output;
  }
  private async execute(message: Message): Promise<ChatResult> {
    // Each recovery attempt gets a fresh wall-clock budget; logical record dates stay frozen.
    const deadline = Date.now() + 360000;
    const remaining = () => {
      const budget = deadline - Date.now();
      if (budget <= 0)
        throw new DomainError(
          'MODEL_TIMEOUT',
          '本次 AI 处理超时，请查看回执后重试',
          504,
          true,
        );
      return Math.min(120000, budget);
    };
    const result: ChatResult = {
      message_id: message.id,
      status: 'failed',
      assistant_text: '',
      record_receipts: [],
      proposals: [],
      recommendations: [],
      affected_dates: [],
      summary: null,
      tool_errors: [],
    };
    try {
      invariant(
        !this.core.services.memory.deletedSources(user).includes(message.id),
        'DELETED_SOURCE',
        '这条消息的记忆来源已删除，请用新消息继续',
        409,
      );
      message.status = 'running';
      this.save(message);
      // Five tool rounds may be followed by one text-only final response.
      while (message.round <= 5) {
        remaining();
        if (!message.pending) {
          if (message.mode === 'model') {
            message.context_snapshot.nutrition_context =
              await this.core.services.memory.nutritionContext(
                user,
                message.ctx.reference_local_date,
              );
          }
          message.pending =
            message.mode === 'rules'
              ? await this.ruleStep(message)
              : await new DeepSeekClient(
                  this.platform,
                  this.modelSettings,
                ).next(this.modelInput(message), remaining());
          this.save(message);
        }
        const step = message.pending;
        if (!step.tool_calls.length) {
          result.status = 'completed';
          result.assistant_text = step.assistant_text;
          message.transcript.push(
            ...(step.response_items ?? [
              { role: 'assistant', content: step.assistant_text },
            ]),
          );
          message.pending = null;
          break;
        }
        invariant(
          message.round < 5,
          'TOOL_LIMIT',
          '本条消息处理已达到上限，请查看回执后发送新消息',
          429,
        );
        const outputs: any[] = [];
        for (let i = 0; i < step.tool_calls.length; i++) {
          remaining();
          const call = step.tool_calls[i],
            output = await this.callTool(message, call, message.round * 20 + i);
          outputs.push(output);
          if (!output?.tool_error && call.name === 'start_workout') {
            message.ctx.workout_session_id = output.id;
            message.ctx.workout_exercise_id = output.current_exercise_id;
          }
          if (
            !output?.tool_error &&
            call.name === 'transition_workout' &&
            output.id === message.ctx.workout_session_id
          )
            message.ctx.workout_exercise_id = output.current_exercise_id;
        }
        message.transcript.push(
          ...(step.response_items ?? [
            {
              role: 'assistant',
              content: step.assistant_text || null,
              tool_calls: step.tool_calls.map((c) => ({
                id: c.call_id,
                type: 'function',
                function: {
                  name: c.name,
                  arguments: JSON.stringify(c.arguments),
                },
              })),
            },
          ]),
        );
        for (let i = 0; i < step.tool_calls.length; i++)
          message.transcript.push({
            role: 'tool',
            tool_call_id: step.tool_calls[i].call_id,
            content: JSON.stringify(
              step.tool_calls[i].name === 'draft_plan'
                ? compactPlan(outputs[i])
                : (outputs[i] ?? null),
            ),
          });
        message.pending = null;
        message.round++;
        this.save(message);
      }
      if (result.status !== 'completed')
        throw new DomainError(
          'TOOL_LIMIT',
          '本条消息处理已达到上限，请查看回执后发送新消息',
          429,
          false,
        );
    } catch (error: any) {
      result.error = {
        code: error.code ?? 'MODEL_ERROR',
        message:
          error instanceof DomainError
            ? error.message
            : 'AI 暂时无法回复，请查看回执后重试',
        retryable: error.retryable ?? true,
      };
      result.assistant_text = result.error.message;
    }
    for (const command of this.commands(message.id)) {
      const call = JSON.parse(command.payload),
        output = command.result;
      if (output?.tool_error) {
        result.tool_errors.push(output.tool_error);
        continue;
      }
      if (
        [
          'record_water',
          'record_food',
          'record_body',
          'edit_record',
          'undo_record',
        ].includes(call.name)
      ) {
        result.record_receipts.push(output);
        result.affected_dates.push(...(output.affected_dates ?? []));
      }
      if (call.name === 'record_set') {
        result.record_receipts.push(output.set);
        if (output.recommendation)
          result.recommendations.push(output.recommendation);
        result.affected_dates.push(output.set.local_date);
      }
      if (['edit_set', 'undo_set'].includes(call.name)) {
        result.record_receipts.push(output);
        result.affected_dates.push(output.local_date);
        result.recommendations.push(
          ...this.core.services.workouts
            .recommendations(user, output.session_id)
            .filter((r: any) => r.status === 'proposed'),
        );
      }
      if (['draft_target', 'draft_plan'].includes(call.name))
        result.proposals.push({
          type: call.name === 'draft_target' ? 'target' : 'plan',
          ...output,
        });
    }
    result.affected_dates = [...new Set(result.affected_dates)];
    if (
      result.error &&
      this.commands(message.id).some(
        (c) =>
          !c.result?.tool_error &&
          ![
            'get_context',
            'get_nutrition_context',
            'query_records',
            'query_history',
            'query_trends',
          ].includes(JSON.parse(c.payload).name),
      )
    )
      result.status = 'partial';
    result.summary = await this.core.services.summary.forDate(
      user,
      message.ctx.reference_local_date,
    );
    message.result = result;
    message.status = result.status;
    this.save(message);
    return result;
  }

  private async ruleStep(message: Message): Promise<ProviderStep> {
    const calls = this.commands(message.id);
    if (calls.length) {
      const last = calls[calls.length - 1],
        output = last.result,
        name = JSON.parse(last.payload).name;
      if (output?.tool_error)
        return {
          assistant_text: output.tool_error.message + '。请核对后重新输入。',
          tool_calls: [],
        };
      const receipt = output.entity ?? output;
      let text =
        name === 'record_water'
          ? `已记录${receipt.amount_ml}毫升水。`
          : name === 'record_body'
            ? `已记录体重${receipt.value}公斤。`
            : name === 'record_set'
              ? `已记录${output.set.weight_kg == null ? '实际重量未提供，' : output.set.weight_kg + '公斤，'}${output.set.reps}次。`
              : '';
      if (
        receipt.local_date &&
        receipt.local_date !== message.ctx.reference_local_date
      )
        text += `归属${receipt.local_date}。`;
      if (
        name === 'record_water' &&
        receipt.local_date === message.ctx.reference_local_date
      ) {
        const budget = (
          await this.core.services.summary.forDate(user, receipt.local_date)
        ).water_ml;
        if (budget.target != null)
          text +=
            budget.over! > 0
              ? `已超出目标${budget.over}毫升。`
              : `当日还剩${budget.remaining}毫升。`;
      }
      if (name === 'record_set' && output.recommendation) {
        const r = output.recommendation;
        text +=
          r.status === 'paused'
            ? '训练已暂停，请先处理疼痛。'
            : r.weight_kg == null
              ? '补充实际重量后再判断下一组。'
              : `下一组建议${r.weight_kg}公斤，${r.reps_min === r.reps_max ? r.reps_min : r.reps_min + '至' + r.reps_max}次。`;
      }
      return {
        assistant_text: text || '已处理，请查看记录回执。',
        tool_calls: [],
      };
    }
    const text = message.request.text.trim().replace(/[\s。！!]/g, '');
    const date = '(今天|昨天|前天|\\d{4}-\\d{2}-\\d{2})?';
    const water = text.match(
      new RegExp(
        '^' +
          date +
          '(?:我)?(?:(?:刚刚?|已)?(?:喝了?|喝过)|饮水|记录饮水|记录)?(\\d+(?:\\.\\d+)?)(毫升|ml|ML|升|L|l)(?:的)?水?$',
      ),
    );
    const body = text.match(
      new RegExp(
        '^' +
          date +
          '(?:我)?(?:记录)?体重(?:是|为|了)?(\\d+(?:\\.\\d+)?)(?:公斤|千克|kg|KG)$',
      ),
    );
    const set = text.match(
      /^(?:这组|刚刚?|我)?(?:用|重量)?(?:(\d+(?:\.\d+)?)(?:kg|公斤))?(?:做了|完成了|做|完成)?(\d+)次(?:[,，]?(轻松|正常|吃力))?$/,
    );
    let call: ToolCall | null = null;
    if (water)
      call = {
        name: 'record_water',
        call_id: 'local-water',
        arguments: {
          amount_ml:
            Number(water[2]) * (/^(升|L|l)$/.test(water[3]) ? 1000 : 1),
          date_expression: water[1] ?? '今天',
          note: null,
        },
      };
    if (body)
      call = {
        name: 'record_body',
        call_id: 'local-body',
        arguments: {
          metric: 'weight_kg',
          value: Number(body[2]),
          date_expression: body[1] ?? '今天',
        },
      };
    if (set)
      call = {
        name: 'record_set',
        call_id: 'local-set',
        arguments: {
          session_id: message.ctx.workout_session_id ?? null,
          exercise_id: message.ctx.workout_exercise_id ?? null,
          weight_kg: set[1] ? Number(set[1]) : null,
          reps: Number(set[2]),
          difficulty: set[3]
            ? ({ 轻松: 'easy', 正常: 'normal', 吃力: 'hard' } as any)[set[3]]
            : null,
          rpe: null,
          pain: false,
          reduce: false,
        },
      };
    if (call) return { assistant_text: '', tool_calls: [call] };
    if (
      /^(今天)?(?:还剩多少(?:水|热量|蛋白质|碳水|脂肪|额度|预算)?|(?:水|热量|蛋白质|碳水|脂肪)还剩多少|剩余额度|查看(?:剩余)?(?:额度|预算)|还可以喝多少水)[?？]?$/.test(
        text,
      )
    ) {
      const summary = message.context_snapshot.today_summary;
      if (!/水|热量|蛋白质|碳水|脂肪/.test(text)) {
        const fields = [
          ['water_ml', '饮水', '毫升'],
          ['calories_kcal', '热量', '千卡'],
          ['carbs_g', '碳水', '克'],
          ['protein_g', '蛋白质', '克'],
          ['fat_g', '脂肪', '克'],
        ];
        const parts = fields
          .filter(([key]) => summary?.[key]?.target != null)
          .map(([key, label, unit]) => {
            const b = summary[key];
            return b.incomplete
              ? label + '未知'
              : b.over > 0
                ? label + '超出' + b.over + unit
                : label +
                  '剩' +
                  b.remaining +
                  unit +
                  (b.estimated ? '（估算）' : '');
          });
        return {
          assistant_text: parts.length
            ? '今天' + parts.join('，') + '。'
            : '尚未设置已生效的每日目标，暂时没有剩余额度。',
          tool_calls: [],
        };
      }
      const selected = /蛋白质/.test(text)
        ? ['protein_g', '蛋白质', '克']
        : /碳水/.test(text)
          ? ['carbs_g', '碳水', '克']
          : /脂肪/.test(text)
            ? ['fat_g', '脂肪', '克']
            : /热量/.test(text)
              ? ['calories_kcal', '热量', '千卡']
              : ['water_ml', '饮水', '毫升'];
      const budget = summary?.[selected[0]];
      return {
        assistant_text:
          budget?.target == null
            ? '尚未设置已生效的每日目标，暂时没有剩余额度。'
            : budget.incomplete
              ? `${selected[1]}含未知营养，无法计算准确余额。`
              : budget.over > 0
                ? `今天${selected[1]}已超出${budget.over}${selected[2]}。`
                : `今天${selected[1]}还剩${budget.remaining}${selected[2]}${budget.estimated ? '（含估算）' : ''}。`,
        tool_calls: [],
      };
    }
    return {
      assistant_text:
        '当前使用本地规则助手。请一次填写一条明确记录，例如“喝了300毫升水”“体重70公斤”或“这组60kg做了12次”。饮食、计划和复杂对话需在设置中配置AI。',
      tool_calls: [],
    };
  }
}
