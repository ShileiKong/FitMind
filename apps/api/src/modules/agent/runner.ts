import type {
  ChatRequest,
  ChatResult,
  CommandContext,
} from '@fitmind/contracts';
import type { FitMindApp } from '../../app.js';
import { Store, canonical } from '../../db/store.js';
import type { TextAgentProvider } from '../../providers/types.js';
import { agentTools, executeTool } from './tools.js';
import { coachPrompt } from './prompts.js';
import { invariant, DomainError } from '../../http/errors.js';
import { getTimeContext, resolveReferenceDate } from '../time/service.js';
export class AgentRunner {
  private active = new Map<string, Promise<ChatResult>>();
  constructor(
    private app: FitMindApp,
    private provider: TextAgentProvider,
  ) {}
  async submit(ctx: CommandContext, request: ChatRequest): Promise<ChatResult> {
    const store = this.app.store;
    const db = store.db;
    invariant(
      request.message_id && request.conversation_id && request.text?.trim(),
      'INVALID_MESSAGE',
      '消息不能为空',
    );
    const existing = db
      .prepare('SELECT * FROM messages WHERE id=?')
      .get(request.message_id) as any;
    if (existing) {
      invariant(
        existing.user_id === ctx.user_id &&
          existing.request === canonical(request),
        'MESSAGE_CONFLICT',
        '消息 ID 已用于不同内容',
        409,
      );
    } else {
      for (const id of request.attachment_ids ?? []) {
        const media = this.app.services.media.readOwned(ctx.user_id, id);
        invariant(media.kind === 'image', 'NOT_IMAGE', '对话附件需要图片');
      }
      const workout = request.workout_session_id
        ? this.app.services.workouts.get(
            ctx.user_id,
            request.workout_session_id,
          )
        : request.workout_session_id === null
          ? null
          : this.app.services.workouts
              .list(ctx.user_id)
              .find((w: any) => ['active', 'paused'].includes(w.status));
      const time = getTimeContext(this.app.deps.clock, ctx.timezone);
      const frozen = {
        ...ctx,
        now_utc: time.now_utc,
        reference_local_date: resolveReferenceDate(request, time),
        source_message_id: request.message_id,
        workout_session_id: workout?.id ?? null,
        workout_exercise_id:
          request.workout_exercise_id ?? workout?.current_exercise_id ?? null,
      };
      db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?)').run(
        request.message_id,
        ctx.user_id,
        request.conversation_id,
        canonical(request),
        JSON.stringify({
          ctx: frozen,
          transcript: [{ role: 'user', content: request.text }],
          round: 0,
          pending: null,
        }),
        null,
        'pending',
        ctx.now_utc,
      );
    }
    return this.recover(ctx, request.message_id);
  }
  async recover(ctx: CommandContext, id: string): Promise<ChatResult> {
    const row = this.app.store.db
      .prepare('SELECT * FROM messages WHERE id=? AND user_id=?')
      .get(id, ctx.user_id) as any;
    invariant(row, 'NOT_FOUND', '消息不存在', 404);
    if (row.state === 'completed') return JSON.parse(row.result);
    if (this.active.has(id)) return this.active.get(id)!;
    const p = this.run(row);
    this.active.set(id, p);
    try {
      return await p;
    } finally {
      this.active.delete(id);
    }
  }
  get(user: string, id: string) {
    const r = this.app.store.db
      .prepare('SELECT result,state FROM messages WHERE id=? AND user_id=?')
      .get(id, user) as any;
    invariant(r, 'NOT_FOUND', '消息不存在', 404);
    return r.result
      ? JSON.parse(r.result)
      : { message_id: id, status: r.state };
  }
  list(user: string, conversation = 'main') {
    const deleted = new Set(this.app.services.memory.deletedSources(user));
    return (
      this.app.store.db
        .prepare(
          'SELECT id,request,result,state,created_at FROM messages WHERE user_id=? AND conversation_id=? ORDER BY created_at DESC,rowid DESC LIMIT 50',
        )
        .all(user, conversation) as any[]
    )
      .filter((r) => !deleted.has(r.id))
      .reverse()
      .map((r) => ({
        message_id: r.id,
        text: JSON.parse(r.request).text,
        result: r.result ? JSON.parse(r.result) : null,
        status: r.state,
        created_at: r.created_at,
      }));
  }
  private save(id: string, state: any, result?: any) {
    this.app.store.db
      .prepare(
        'UPDATE messages SET context=?,state=?,result=COALESCE(?,result) WHERE id=?',
      )
      .run(
        JSON.stringify(state),
        result?.status ?? 'running',
        result ? JSON.stringify(result) : null,
        id,
      );
  }
  private async run(row: any): Promise<ChatResult> {
    const state = JSON.parse(row.context),
      request = JSON.parse(row.request),
      ctx = state.ctx;
    const result: ChatResult = {
      message_id: row.id,
      status: 'failed',
      assistant_text: '',
      record_receipts: [],
      proposals: [],
      recommendations: [],
      affected_dates: [],
      summary: null,
      tool_errors: [],
    };
    const deadline =
      Date.now() + Number(process.env.AGENT_MESSAGE_TIMEOUT_MS ?? 180000);
    const max = Number(process.env.AGENT_MAX_ROUNDS ?? 5);
    try {
      while (state.round < max) {
        if (Date.now() >= deadline)
          throw new DomainError(
            'MODEL_TIMEOUT',
            '回复超时，可恢复已保存的记录',
            504,
            true,
          );
        if (!state.pending) {
          if (!state.context_snapshot) {
            state.context_snapshot =
              await this.app.services.memory.buildContext(ctx.user_id, {
                ...request,
                reference_local_date: ctx.reference_local_date,
                workout_session_id: ctx.workout_session_id,
              });
            const boundary = this.app.store.db
              .prepare('SELECT rowid FROM messages WHERE id=?')
              .get(row.id) as any;
            const preceding = new Set(
              (
                this.app.store.db
                  .prepare(
                    'SELECT id FROM messages WHERE user_id=? AND rowid<?',
                  )
                  .all(ctx.user_id, boundary.rowid) as any[]
              ).map((m) => m.id),
            );
            state.prior_snapshot = this.list(
              ctx.user_id,
              request.conversation_id,
            )
              .filter(
                (m: any) =>
                  preceding.has(m.message_id) &&
                  m.result?.status === 'completed',
              )
              .slice(-8);
            this.save(row.id, state);
          }
          const deleted = new Set(
            this.app.services.memory.deletedSources(ctx.user_id),
          );
          const context = {
            ...state.context_snapshot,
            memories: state.context_snapshot.memories.filter(
              (m: any) => !m.source_ids.some((id: string) => deleted.has(id)),
            ),
          };
          const prior = state.prior_snapshot
            .filter((m: any) => !deleted.has(m.message_id))
            .flatMap((m: any) => [
              { role: 'user', content: m.text },
              { role: 'assistant', content: m.result.assistant_text },
            ]);
          const timeout = Math.max(
            1,
            Math.min(
              Number(process.env.AGENT_MODEL_TIMEOUT_MS ?? 60000),
              deadline - Date.now(),
            ),
          );
          const abort = AbortSignal.timeout(timeout);
          // Race protects adapters which fail to honor AbortSignal; only the runner executes tools.
          const step = await Promise.race([
            this.provider.next(
              {
                instructions:
                  coachPrompt + '\n当前真实状态：' + JSON.stringify(context),
                transcript: [...prior, ...state.transcript],
                tools: agentTools,
              },
              abort,
            ),
            new Promise<never>((_, reject) => {
              abort.addEventListener(
                'abort',
                () =>
                  reject(
                    new DomainError('MODEL_TIMEOUT', '模型回复超时', 504, true),
                  ),
                { once: true },
              );
            }),
          ]);
          invariant(
            step &&
              Array.isArray(step.tool_calls ?? []) &&
              (step.tool_calls ?? []).length <= 20,
            'MODEL_FORMAT',
            '模型工具响应无效',
            502,
          );
          state.pending = { ...step, tool_calls: step.tool_calls ?? [] };
          this.save(row.id, state);
        }
        const step = state.pending;
        if (!step.tool_calls.length) {
          result.status = 'completed';
          result.assistant_text = step.assistant_text ?? '';
          state.pending = null;
          break;
        }
        for (let i = 0; i < step.tool_calls.length; i++) {
          const call = step.tool_calls[i],
            slot = state.round + ':' + i,
            payload = canonical(call);
          let cmd = this.app.store.db
            .prepare(
              'SELECT payload,result FROM commands WHERE message_id=? AND action_slot=?',
            )
            .get(row.id, slot) as any;
          let output: any;
          if (cmd) {
            invariant(
              cmd.payload === payload,
              'COMMAND_CONFLICT',
              '恢复的工具命令不一致',
              409,
            );
            output = JSON.parse(cmd.result);
          } else {
            try {
              output = await executeTool(
                this.app,
                {
                  ...ctx,
                  idempotency_key: row.id + ':' + slot,
                  journal: { message_id: row.id, slot, payload },
                },
                request,
                call.name,
                call.arguments,
              );
            } catch (e: any) {
              output = {
                tool_error: {
                  code: e.code ?? 'TOOL_ERROR',
                  message: e.status ? e.message : '工具参数或操作无效',
                },
              };
            }
            this.app.store.db
              .prepare('INSERT OR IGNORE INTO commands VALUES(?,?,?,?)')
              .run(row.id, slot, payload, JSON.stringify(output ?? null));
          }
          // Only a successful command in THIS message may change its frozen workout binding.
          if (!output?.tool_error && call.name === 'start_workout') {
            ctx.workout_session_id = output.id;
            ctx.workout_exercise_id = output.current_exercise_id;
          }
          if (
            !output?.tool_error &&
            call.name === 'transition_workout' &&
            output.id === ctx.workout_session_id
          )
            ctx.workout_exercise_id = output.current_exercise_id;
        }
        if (
          this.app.deps.providers?.mode === 'chat_completions' ||
          (this.provider as any).options?.mode === 'chat_completions'
        ) {
          state.transcript.push(
            ...(step.response_items ?? [
              {
                role: 'assistant',
                content: step.assistant_text ?? '',
                tool_calls: step.tool_calls.map((c: any) => ({
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
          for (let i = 0; i < step.tool_calls.length; i++) {
            const c = step.tool_calls[i];
            const cmd: any = this.app.store.db
              .prepare(
                'SELECT result FROM commands WHERE message_id=? AND action_slot=?',
              )
              .get(row.id, state.round + ':' + i);
            state.transcript.push({
              role: 'tool',
              tool_call_id: c.call_id,
              content: cmd.result,
            });
          }
        } else {
          state.transcript.push(
            ...(step.response_items ??
              step.tool_calls.map((c: any) => ({
                type: 'function_call',
                call_id: c.call_id,
                name: c.name,
                arguments: JSON.stringify(c.arguments),
              }))),
          );
          for (let i = 0; i < step.tool_calls.length; i++) {
            const cmd: any = this.app.store.db
              .prepare(
                'SELECT result FROM commands WHERE message_id=? AND action_slot=?',
              )
              .get(row.id, state.round + ':' + i);
            state.transcript.push({
              type: 'function_call_output',
              call_id: step.tool_calls[i].call_id,
              output: cmd.result,
            });
          }
        }
        state.pending = null;
        state.round++;
        this.save(row.id, state);
      }
      if (result.status !== 'completed')
        throw new DomainError(
          'TOOL_LIMIT',
          '本条消息已达到工具轮数上限，请查看回执后继续',
          429,
          false,
        );
    } catch (e: any) {
      result.error = {
        code: e.code ?? 'MODEL_ERROR',
        message: e.status ? e.message : '模型暂时无法回复，可恢复查询记录',
        retryable: e.retryable ?? true,
      };
      result.assistant_text = result.error.message;
    }
    const commands = this.app.store.db
      .prepare(
        'SELECT payload,result FROM commands WHERE message_id=? ORDER BY rowid',
      )
      .all(row.id) as any[];
    for (const c of commands) {
      const call = JSON.parse(c.payload),
        out = JSON.parse(c.result);
      if (out?.tool_error) {
        result.tool_errors.push(out.tool_error);
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
        result.record_receipts.push(out);
        result.affected_dates.push(...out.affected_dates);
      }
      if (call.name === 'record_set') {
        result.record_receipts.push(out.set);
        result.recommendations.push(out.recommendation);
        result.affected_dates.push(out.set.local_date);
      }
      if (['edit_set', 'undo_set'].includes(call.name)) {
        result.record_receipts.push(out);
        result.affected_dates.push(out.local_date);
        result.recommendations.push(
          ...this.app.services.workouts
            .recommendations(ctx.user_id, out.session_id)
            .filter((r: any) => r.status === 'proposed'),
        );
      }
      if (call.name.startsWith('draft_'))
        result.proposals.push({
          type: call.name === 'draft_target' ? 'target' : 'plan',
          ...out,
        });
    }
    result.affected_dates = [...new Set(result.affected_dates)];
    if (result.error && result.record_receipts.length)
      result.status = 'partial';
    result.summary = await this.app.services.summary.forDate(
      ctx.user_id,
      ctx.reference_local_date,
    );
    this.save(row.id, state, result);
    return result;
  }
}
