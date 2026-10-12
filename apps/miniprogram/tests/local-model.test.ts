import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeepSeekClient } from '../src/local/model';

afterEach(() => vi.useRealTimers());
const input = {
  instructions: '用中文简短回复。',
  transcript: [{ role: 'user', content: '你好' }],
  tools: [],
};
const response = (message: any, finish_reason = 'stop') => ({
  statusCode: 200,
  data: { choices: [{ message, finish_reason }] },
});
const make = (body: any) =>
  new DeepSeekClient(
    {
      request: (options: any) => {
        queueMicrotask(() => options.success(body));
        return { abort() {} };
      },
    },
    { api_key: 'secret-test-key', model: 'deepseek-flash' },
  );

describe('direct DeepSeek boundary', () => {
  it.each([
    'request:fail url not in domain list',
    'request:fail 请求域名不在合法域名列表中',
  ])(
    'reports actionable domain setup without echoing raw diagnostics: %s',
    async (diagnostic) => {
      const model = new DeepSeekClient(
        {
          request: (options: any) => {
            queueMicrotask(() =>
              options.fail({ errMsg: diagnostic + ' secret-test-key' }),
            );
            return { abort() {} };
          },
        },
        { api_key: 'secret-test-key', model: 'deepseek-flash' },
      );
      const error = await model.next(input).catch((error) => error);
      expect(error.code).toBe('MODEL_DOMAIN');
      expect(error.message).toContain('https://api.deepseek.com');
      expect(error.message).toContain('request 合法域名');
      expect(JSON.stringify(error)).not.toContain('secret-test-key');
    },
  );
  it.each([
    response({ role: 'assistant', content: null }),
    response(
      { role: 'assistant', content: '输出失败' },
      'insufficient_system_resource',
    ),
    response({ role: 'assistant', content: '  ' }),
    response({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'same',
          type: 'function',
          function: { name: 'get_context', arguments: '{}' },
        },
        {
          id: 'same',
          type: 'function',
          function: { name: 'get_context', arguments: '{}' },
        },
      ],
    }),
  ])(
    'rejects an incomplete or malformed response before tool execution %#',
    async (body) => {
      await expect(make(body).next(input)).rejects.toMatchObject({
        code: 'MODEL_FORMAT',
        retryable: true,
      });
    },
  );

  it('allows a structured response larger than the old output budget', async () => {
    const text = '计划说明'.repeat(1000);
    const model = new DeepSeekClient(
      {
        request: (options: any) => {
          queueMicrotask(() =>
            options.success(
              response(
                { role: 'assistant', content: text },
                options.data.max_tokens < 8192 ? 'length' : 'stop',
              ),
            ),
          );
          return { abort() {} };
        },
      },
      { api_key: 'secret-test-key', model: 'deepseek-flash' },
    );
    expect((await model.next(input)).assistant_text).toBe(text);
  });

  it('reports length truncation separately and drops incomplete tool arguments', async () => {
    const error = await make(
      response(
        {
          role: 'assistant',
          content: '未完成的计划',
          tool_calls: [
            {
              id: 'unfinished',
              type: 'function',
              function: { name: 'draft_plan', arguments: '{"input":' },
            },
          ],
        },
        'length',
      ),
    )
      .next(input)
      .catch((error) => error);
    expect(error).toMatchObject({ code: 'MODEL_TRUNCATED', retryable: true });
    expect(error.message).toContain('过长');
    expect(error.message).toContain('已保存');
  });

  it('reports a background interruption as recoverable without echoing platform diagnostics', async () => {
    const model = new DeepSeekClient(
      {
        request: (options: any) => {
          queueMicrotask(() =>
            options.fail({
              errMsg: 'request:fail interrupted secret-test-key',
            }),
          );
          return { abort() {} };
        },
      },
      { api_key: 'secret-test-key', model: 'deepseek-flash' },
    );
    const error = await model.next(input).catch((error) => error);
    expect(error).toMatchObject({ code: 'MODEL_INTERRUPTED', retryable: true });
    expect(error.message).toContain('前台');
    expect(JSON.stringify(error)).not.toContain('secret-test-key');
  });

  it('bounds an adapter that never calls back and ignores its late tool response', async () => {
    vi.useFakeTimers();
    let callback: any,
      aborted = false;
    const model = new DeepSeekClient(
      {
        request: (options: any) => {
          callback = options.success;
          return {
            abort() {
              aborted = true;
            },
          };
        },
      },
      { api_key: 'secret-test-key', model: 'deepseek-flash' },
    );
    const pending = model.next(input).catch((error) => error);
    await vi.advanceTimersByTimeAsync(120000);
    const error = await pending;
    expect(error).toMatchObject({ code: 'MODEL_TIMEOUT', retryable: true });
    expect(aborted).toBe(true);
    callback(response({ role: 'assistant', content: 'secret-test-key' }));
    expect(await pending).toBe(error);
  });

  it('redacts an echoed secret from visible output and tool argument values without changing field names', async () => {
    const result = await make(
      response(
        {
          role: 'assistant',
          content: '<think>hidden</think>secret-test-key',
          reasoning_content: 'hidden-reason',
          tool_calls: [
            {
              id: 'memory',
              type: 'function',
              function: {
                name: 'remember',
                arguments: '{"key":"equipment","value":"secret-test-key"}',
              },
            },
          ],
        },
        'tool_calls',
      ),
    ).next(input);
    expect(result.tool_calls[0].arguments.key).toBe('equipment');
    expect(JSON.stringify(result)).not.toContain('secret-test-key');
    expect(JSON.stringify(result)).not.toContain('hidden-reason');
    expect(result.assistant_text).not.toContain('hidden');
  });
});
