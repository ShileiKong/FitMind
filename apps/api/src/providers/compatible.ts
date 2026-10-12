import type {
  AgentModelInput,
  ProviderStep,
  TextAgentProvider,
} from './types.js';
import { DomainError, invariant } from '../http/errors.js';
import { visibleAssistantText } from '@fitmind/contracts/assistant-text';
export interface CompatibleOptions {
  mode: 'responses' | 'chat_completions';
  base_url: string;
  api_key: string;
  model: string;
  reasoning_effort?: string;
  fetch?: typeof fetch;
}
export class CompatibleProvider implements TextAgentProvider {
  constructor(public options: CompatibleOptions) {}
  async next(
    input: AgentModelInput,
    signal: AbortSignal,
  ): Promise<ProviderStep> {
    const o = this.options;
    invariant(
      o.api_key && o.model,
      'AI_UNCONFIGURED',
      '请在后端配置模型 API Key 和模型名',
      503,
    );
    const base = o.base_url.replace(/\/$/, '');
    const responses = o.mode === 'responses';
    const tools = input.tools.map((t) =>
      responses
        ? { type: 'function', ...t, strict: true }
        : { type: 'function', function: { ...t, strict: true } },
    );
    const body = responses
      ? {
          model: o.model,
          instructions: input.instructions,
          input: input.transcript,
          tools,
          store: false,
          ...(o.reasoning_effort
            ? { reasoning: { effort: o.reasoning_effort } }
            : {}),
        }
      : {
          model: o.model,
          messages: [
            { role: 'system', content: input.instructions },
            ...input.transcript,
          ],
          tools,
          ...(o.reasoning_effort
            ? { reasoning_effort: o.reasoning_effort }
            : {}),
        };
    const res = await (o.fetch ?? fetch)(
      base + (responses ? '/responses' : '/chat/completions'),
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + o.api_key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      },
    );
    if (!res.ok)
      throw new DomainError(
        'MODEL_HTTP_ERROR',
        '模型请求失败（HTTP ' + res.status + '），已保存的记录可查询',
        502,
        true,
      );
    const json: any = await res.json();
    try {
      if (responses) {
        const items = json.output ?? [];
        return {
          assistant_text: visibleAssistantText(
            items
              .filter((i: any) => i.type === 'message')
              .flatMap((i: any) => i.content ?? [])
              .filter((c: any) => c.type === 'output_text')
              .map((c: any) => c.text)
              .join('\n'),
          ),
          tool_calls: items
            .filter((i: any) => i.type === 'function_call')
            .map((i: any) => ({
              name: i.name,
              arguments: JSON.parse(i.arguments),
              call_id: i.call_id,
            })),
          response_items: items,
        };
      }
      const m = json.choices?.[0]?.message;
      invariant(m, 'MODEL_FORMAT', '模型返回格式无效', 502);
      return {
        assistant_text: visibleAssistantText(
          typeof m.content === 'string' ? m.content : '',
        ),
        tool_calls: (m.tool_calls ?? []).map((c: any) => ({
          name: c.function.name,
          arguments: JSON.parse(c.function.arguments),
          call_id: c.id,
        })),
        response_items: [m],
      };
    } catch {
      throw new DomainError(
        'MODEL_FORMAT',
        '模型返回的工具参数无法解析',
        502,
        true,
      );
    }
  }
}
