import { CompatibleProvider } from './compatible.js';
import type { TextAgentProvider } from './types.js';
import { DomainError } from '../http/errors.js';
export function createTextProvider(): TextAgentProvider {
  if (process.env.AI_PROVIDER === 'demo')
    return {
      next: async (input) => {
        const last = input.transcript.at(-1);
        if (last?.role !== 'user')
          return { assistant_text: '演示模式：记录已保存。', tool_calls: [] };
        const text = typeof last.content === 'string' ? last.content : '';
        const m = text.match(/(?:喝|水).*?([0-9]+)\s*(ml|毫升|升|L)/i);
        if (m)
          return {
            assistant_text: '',
            tool_calls: [
              {
                name: 'record_water',
                call_id: 'demo-water',
                arguments: {
                  amount_ml: Number(m[1]) * (/^(升|L)$/i.test(m[2]) ? 1000 : 1),
                  date_expression: text.includes('昨天') ? '昨天' : '今天',
                  note: '演示模式解析',
                },
              },
            ],
          };
        return {
          assistant_text:
            '当前是明确启用的演示模式，仅解析简单饮水句子。完整饮食、计划和训练对话需要接入模型 API。',
          tool_calls: [],
        };
      },
    };
  if (
    !['responses', 'chat_completions'].includes(process.env.AI_PROVIDER ?? '')
  )
    return {
      next: async () => {
        throw new DomainError(
          'AI_UNCONFIGURED',
          'AI 尚未配置，请在后端 .env 填写 API；手动记录可正常使用',
          503,
        );
      },
    };
  return new CompatibleProvider({
    mode: process.env.AI_PROVIDER as any,
    base_url: process.env.AI_BASE_URL ?? 'https://api.openai.com/v1',
    api_key: process.env.AI_API_KEY ?? '',
    model: process.env.AI_MODEL ?? '',
    reasoning_effort: process.env.AI_REASONING_EFFORT?.trim() || undefined,
  });
}
export function providerCapabilities() {
  return {
    text:
      !!process.env.AI_API_KEY &&
      !!process.env.AI_MODEL &&
      ['responses', 'chat_completions'].includes(process.env.AI_PROVIDER ?? ''),
    demo: process.env.AI_PROVIDER === 'demo',
    vision:
      !!(process.env.VISION_API_KEY || process.env.AI_API_KEY) &&
      !!process.env.VISION_MODEL,
    transcription:
      !!process.env.TRANSCRIPTION_API_KEY && !!process.env.TRANSCRIPTION_MODEL,
    provider: process.env.AI_PROVIDER ?? 'unconfigured',
  };
}
