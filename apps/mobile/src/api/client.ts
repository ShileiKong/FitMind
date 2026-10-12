import type { ApiEnvelope } from '@fitmind/contracts';
export function agentRequestTimeout(method: string, path: string) {
  return method === 'POST' &&
    (path === '/chat' ||
      path === '/chat/messages' ||
      /^\/messages\/[^/]+\/recover$/.test(path))
    ? 190000
    : undefined;
}
export interface ApiClientOptions {
  base_url: string;
  getToken: () => Promise<string>;
  fetch?: typeof fetch;
  timeout_ms?: number;
}
export class ApiClientError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable: boolean,
    public request_id?: string,
    public status?: number,
  ) {
    super(message);
  }
}
export class ApiClient {
  constructor(private options: ApiClientOptions) {}
  async request<T = any>(
    method: string,
    path: string,
    body?: unknown,
    options: { idempotency_key?: string; timeout_ms?: number } = {},
  ): Promise<ApiEnvelope<T>> {
    const token = await this.options.getToken();
    const headers: Record<string, string> = {
      Authorization: 'Bearer ' + token,
    };
    const multipart = body instanceof FormData;
    if (body && !multipart) headers['Content-Type'] = 'application/json';
    if (options.idempotency_key)
      headers['Idempotency-Key'] = options.idempotency_key;
    const abort = new AbortController(),
      timer = setTimeout(
        () => abort.abort(),
        options.timeout_ms ??
          this.options.timeout_ms ??
          agentRequestTimeout(method, path) ??
          15000,
      );
    try {
      const response = await (this.options.fetch ?? fetch)(
        this.options.base_url.replace(/\/$/, '') + '/api/v1' + path,
        {
          method,
          headers,
          body:
            body === undefined
              ? undefined
              : multipart
                ? body
                : JSON.stringify(body),
          signal: abort.signal,
        },
      );
      const json = await response.json();
      if (!response.ok)
        throw new ApiClientError(
          json.error?.code ?? 'HTTP_ERROR',
          json.error?.message ?? '请求失败',
          json.error?.retryable ?? response.status >= 500,
          json.request_id,
          response.status,
        );
      return json;
    } catch (e) {
      if (e instanceof ApiClientError) throw e;
      throw new ApiClientError(
        'NETWORK_ERROR',
        abort.signal.aborted
          ? '请求超时，输入已保留；请检查回执后重试'
          : '无法连接服务，输入已保留',
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
