import { visibleAssistantText } from '@fitmind/contracts/assistant-text';
import { DomainError, invariant } from '../../../api/src/http/errors';
import type {
  AgentModelInput,
  ProviderStep,
} from '../../../api/src/providers/types';

export interface ModelSettings {
  api_key: string;
  model: string;
}
export const modelStorageKey = 'fitmind.local.model.v1';
export const defaultModel = 'deepseek-flash';
function valid(condition: unknown, message: string): asserts condition {
  if (!condition) throw new DomainError('MODEL_FORMAT', message, 502, true);
}

/** Only the authentication header receives the locally stored secret. */
export class DeepSeekClient {
  constructor(
    private platform: any,
    private settings: ModelSettings,
  ) {}

  next(input: AgentModelInput, timeoutMs = 120000): Promise<ProviderStep> {
    const settings = this.settings;
    const timeout = Math.max(1, Math.min(120000, timeoutMs));
    invariant(
      settings.api_key,
      'AI_UNCONFIGURED',
      '请先在设置中填写 DeepSeek API Key',
    );
    return new Promise((resolve, reject) => {
      let settled = false;
      let task: any;
      const fail = (error: DomainError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };
      // Also bound adapters that never invoke either wx.request callback.
      const timer = setTimeout(() => {
        fail(
          new DomainError(
            'MODEL_TIMEOUT',
            'AI 回复超时，请查看回执后重试',
            504,
            true,
          ),
        );
        task?.abort?.();
      }, timeout);
      try {
        task = this.platform.request({
          url: 'https://api.deepseek.com/chat/completions',
          method: 'POST',
          header: {
            Authorization: 'Bearer ' + settings.api_key,
            'Content-Type': 'application/json',
          },
          timeout,
          data: {
            model: settings.model,
            messages: [
              { role: 'system', content: input.instructions },
              ...input.transcript,
            ],
            thinking: { type: 'disabled' },
            max_tokens: 2048,
            stream: false,
            ...(input.tools.length
              ? {
                  tools: input.tools.map((t) => ({
                    type: 'function',
                    function: t,
                  })),
                }
              : {}),
          },
          success: (response: any) => {
            if (settled) return;
            try {
              if (response?.statusCode === 401 || response?.statusCode === 403)
                throw new DomainError(
                  'MODEL_AUTH',
                  'AI 密钥无法使用，请在设置中核对',
                  502,
                  false,
                );
              if (
                !response ||
                response.statusCode < 200 ||
                response.statusCode >= 300
              )
                throw new DomainError(
                  'MODEL_HTTP_ERROR',
                  'AI 暂时无法回复，请查看回执后重试',
                  502,
                  true,
                );
              const json =
                typeof response.data === 'string'
                  ? JSON.parse(response.data)
                  : response.data;
              const choice = json?.choices?.[0];
              const message = choice?.message;
              valid(
                message &&
                  (message.content == null ||
                    typeof message.content === 'string') &&
                  Array.isArray(message.tool_calls ?? []) &&
                  (message.tool_calls ?? []).length <= 20 &&
                  ['stop', 'tool_calls'].includes(choice.finish_reason),
                'AI 返回不完整，请查看回执后重试',
              );
              const seen = new Set<string>();
              const calls = (message.tool_calls ?? []).map((call: any) => {
                valid(
                  call?.type === 'function' &&
                    typeof call.id === 'string' &&
                    call.id &&
                    !seen.has(call.id) &&
                    typeof call.function?.name === 'string' &&
                    typeof call.function.arguments === 'string',
                  'AI 工具响应无效，请重试',
                );
                seen.add(call.id);
                const args = JSON.parse(call.function.arguments);
                valid(
                  args && typeof args === 'object' && !Array.isArray(args),
                  'AI 工具参数无效，请重试',
                );
                return {
                  call_id: call.id,
                  name: call.function.name,
                  arguments: args,
                };
              });
              const clean = (value: string) =>
                value.split(settings.api_key).join('[已隐藏密钥]');
              const safeValue = (value: any): any =>
                typeof value === 'string'
                  ? clean(value)
                  : Array.isArray(value)
                    ? value.map(safeValue)
                    : value && typeof value === 'object'
                      ? Object.fromEntries(
                          Object.entries(value).map(([name, entry]) => [
                            name,
                            safeValue(entry),
                          ]),
                        )
                      : value;
              const content = clean(
                visibleAssistantText(message.content ?? ''),
              );
              const safeCalls = calls.map((call: any) => ({
                ...call,
                arguments: safeValue(call.arguments),
              }));
              valid(
                content.length > 0 || safeCalls.length > 0,
                'AI 未返回有效回复，请查看回执后重试',
              );
              const step: ProviderStep = {
                assistant_text: content,
                tool_calls: safeCalls,
                // Preserve protocol continuation, never persist reasoning_content.
                response_items: [
                  {
                    role: 'assistant',
                    content: content || null,
                    ...(safeCalls.length
                      ? {
                          tool_calls: safeCalls.map((call: any) => ({
                            id: call.call_id,
                            type: 'function',
                            function: {
                              name: call.name,
                              arguments: JSON.stringify(call.arguments),
                            },
                          })),
                        }
                      : {}),
                  },
                ],
              };
              settled = true;
              clearTimeout(timer);
              resolve(step);
            } catch (error) {
              fail(
                error instanceof DomainError
                  ? error
                  : new DomainError(
                      'MODEL_FORMAT',
                      'AI 返回格式无效，请查看回执后重试',
                      502,
                      true,
                    ),
              );
            }
          },
          fail: (error: any) => {
            if (
              typeof error?.errMsg === 'string' &&
              /url\s+not\s+in\s+domain\s*list|合法域名/i.test(error.errMsg)
            ) {
              fail(
                new DomainError(
                  'MODEL_DOMAIN',
                  'AI 域名未配置，请在微信开发者平台把 https://api.deepseek.com 添加到 request 合法域名',
                  502,
                  false,
                ),
              );
              return;
            }
            fail(
              new DomainError(
                'MODEL_NETWORK',
                'AI 连接失败或超时，已保存的记录可查询，请重试',
                502,
                true,
              ),
            );
          },
        });
      } catch {
        fail(
          new DomainError(
            'MODEL_NETWORK',
            'AI 连接失败，请查看回执后重试',
            502,
            true,
          ),
        );
      }
    });
  }
}
