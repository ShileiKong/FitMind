import { it, expect } from 'vitest';
import { CompatibleProvider } from '../src/providers/compatible.js';
const input: any = {
  instructions: 'coach',
  transcript: [{ role: 'user', content: 'hi' }],
  tools: [
    {
      name: 'water',
      description: 'x',
      parameters: {
        type: 'object',
        properties: { amount: { type: 'number' } },
        required: ['amount'],
        additionalProperties: false,
      },
    },
  ],
};
it('responses_parses_tools_and_model', async () => {
  let body: any;
  const p = new CompatibleProvider({
    mode: 'responses',
    base_url: 'https://example.com/v1',
    api_key: 'key',
    model: 'model',
    fetch: async (_: any, o: any) => {
      body = JSON.parse(o.body);
      return new Response(
        JSON.stringify({
          output: [
            {
              type: 'function_call',
              name: 'water',
              arguments: '{"amount":300}',
              call_id: 'c',
            },
          ],
        }),
      );
    },
  });
  const s = await p.next(input, new AbortController().signal);
  expect(s.tool_calls[0].arguments.amount).toBe(300);
  expect(body.model).toBe('model');
  expect(body.tools[0].parameters.additionalProperties).toBe(false);
});
it('chat_parses_text', async () => {
  const p = new CompatibleProvider({
    mode: 'chat_completions',
    base_url: 'https://example.com/v1',
    api_key: 'key',
    model: 'm',
    fetch: async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '收到', tool_calls: [] } }],
        }),
      ),
  });
  expect(
    (await p.next(input, new AbortController().signal)).assistant_text,
  ).toBe('收到');
});
it('abort_and_unconfigured_are_explicit', async () => {
  const p = new CompatibleProvider({
    mode: 'responses',
    base_url: 'https://example.com/v1',
    api_key: '',
    model: '',
  });
  await expect(
    p.next(input, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'AI_UNCONFIGURED' });
});

it.each(['responses', 'chat_completions'] as const)(
  '%s forwards configured reasoning effort without changing the model',
  async (mode) => {
    let body: any;
    const p = new CompatibleProvider({
      mode,
      base_url: 'https://example.com/v1',
      api_key: 'key',
      model: 'm',
      reasoning_effort: 'low',
      fetch: async (_: any, init: any) => {
        body = JSON.parse(init.body);
        return new Response(
          JSON.stringify(
            mode === 'responses'
              ? {
                  output: [
                    {
                      type: 'message',
                      content: [{ type: 'output_text', text: '收到' }],
                    },
                  ],
                }
              : { choices: [{ message: { content: '收到' } }] },
          ),
        );
      },
    });
    expect(
      (await p.next(input, new AbortController().signal)).assistant_text,
    ).toBe('收到');
    expect(body.model).toBe('m');
    expect(
      mode === 'responses' ? body.reasoning?.effort : body.reasoning_effort,
    ).toBe('low');
  },
);

it.each(['responses', 'chat_completions'] as const)(
  '%s hides reasoning while retaining the original items for tool continuation',
  async (mode) => {
    const original =
      mode === 'responses'
        ? [
            {
              type: 'reasoning',
              content: [
                { type: 'reasoning_text', text: 'PRIVATE_REASONING_SENTINEL' },
              ],
            },
            {
              type: 'message',
              role: 'assistant',
              content: [
                {
                  type: 'output_text',
                  text: '<think>TAGGED_THOUGHT_SENTINEL</think>已记录 300 毫升。',
                },
              ],
            },
          ]
        : [
            {
              role: 'assistant',
              reasoning_content: 'PRIVATE_REASONING_SENTINEL',
              content:
                '<think>TAGGED_THOUGHT_SENTINEL</think>已记录 300 毫升。',
            },
          ];
    const provider = new CompatibleProvider({
      mode,
      base_url: 'https://example.com/v1',
      api_key: 'key',
      model: 'm',
      fetch: async () =>
        new Response(
          JSON.stringify(
            mode === 'responses'
              ? { output: original }
              : { choices: [{ message: original[0] }] },
          ),
        ),
    });
    const step = await provider.next(input, new AbortController().signal);
    expect(step.assistant_text).toBe('已记录 300 毫升。');
    expect(step.response_items).toEqual(original);
  },
);
