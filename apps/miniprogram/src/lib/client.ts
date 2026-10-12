export interface Settings {
  base_url: string;
  token: string;
}
export interface Pending {
  id: string;
  method: string;
  path: string;
  body: any;
  created_at: string;
  error?: string;
}
export class MiniError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}
export function commandId() {
  return (
    'wx-' +
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2)
  );
}
function scope(s: Settings) {
  let a = 2166136261,
    b = 5381;
  for (const c of s.base_url + '|' + s.token) {
    a = Math.imul(a ^ c.charCodeAt(0), 16777619);
    b = Math.imul(b, 33) ^ c.charCodeAt(0);
  }
  return 'fitmind.' + (a >>> 0).toString(36) + (b >>> 0).toString(36);
}
function empty() {
  return {
    context: null,
    summary: null,
    records: [],
    plans: [],
    days: [],
    targets: [],
    messages: [],
    memories: [],
    profile: null,
    capabilities: null,
  } as any;
}
export class MiniClient {
  settings: Settings | null;
  data = empty();
  private running = new Set<string>();
  private generation = 0;
  private refreshing: Promise<void> | null = null;
  constructor(private platform: any) {
    this.settings = platform.getStorageSync('fitmind.credentials') || null;
  }
  get connected() {
    return !!this.settings;
  }
  get storageKey() {
    return this.settings ? scope(this.settings) : '';
  }
  saved<T>(name: string, fallback: T): T {
    const value = this.platform.getStorageSync(this.storageKey + '.' + name);
    return value == null || value === '' ? fallback : value;
  }
  save(name: string, data: any) {
    if (this.settings)
      this.platform.setStorageSync(this.storageKey + '.' + name, data);
  }
  async connect(input: Settings) {
    const s = {
      base_url: input.base_url.trim().replace(/\/+$/, ''),
      token: input.token.trim(),
    };
    if (!/^https?:\/\/[a-zA-Z0-9.-]+(?::\d+)?$/.test(s.base_url))
      throw new MiniError(
        'INVALID_URL',
        '请输入完整服务地址，例如 https://你的域名',
      );
    if (
      /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0)(:|$)/i.test(
        s.base_url,
      )
    )
      throw new MiniError(
        'LOOPBACK',
        '手机需要填写电脑的局域网 IP，不能使用 localhost',
      );
    if (!s.token) throw new MiniError('TOKEN_REQUIRED', '请输入个人访问令牌');
    const ctx = await this.transport(
      'GET',
      '/context',
      undefined,
      undefined,
      s,
    );
    this.generation++;
    this.settings = s;
    this.platform.setStorageSync('fitmind.credentials', s);
    this.data = empty();
    this.data.context = ctx;
    this.refreshing = null;
    return ctx;
  }
  disconnect() {
    this.generation++;
    this.settings = null;
    this.data = empty();
    this.platform.removeStorageSync('fitmind.credentials');
    this.refreshing = null;
  }
  private transport(
    method: string,
    path: string,
    body?: any,
    key?: string,
    settings = this.settings,
  ): Promise<any> {
    if (!settings)
      return Promise.reject(
        new MiniError('NOT_CONNECTED', '先在「我的」连接个人服务'),
      );
    return new Promise((resolve, reject) => {
      this.platform.request({
        url: settings.base_url + '/api/v1' + path,
        method,
        data: body,
        header: {
          Authorization: 'Bearer ' + settings.token,
          'Content-Type': 'application/json',
          ...(key ? { 'Idempotency-Key': key } : {}),
        },
        timeout: path === '/chat' || path.endsWith('/recover') ? 190000 : 20000,
        success: (r: any) => {
          let json = r.data;
          try {
            if (typeof json === 'string') json = JSON.parse(json);
          } catch {
            reject(
              new MiniError(
                'INVALID_RESPONSE',
                '服务返回格式不正确，请检查地址',
              ),
            );
            return;
          }
          if (r.statusCode < 200 || r.statusCode >= 300) {
            reject(
              new MiniError(
                json?.error?.code || 'HTTP_ERROR',
                json?.error?.message || '请求失败，请稍后重试',
                json?.error?.retryable ?? r.statusCode >= 500,
              ),
            );
            return;
          }
          if (
            !json ||
            !Object.prototype.hasOwnProperty.call(json, 'data') ||
            !Number.isFinite(Date.parse(json.server_time))
          ) {
            reject(
              new MiniError(
                'INVALID_RESPONSE',
                '服务返回格式不正确，请检查地址',
              ),
            );
            return;
          }
          resolve(json.data);
        },
        fail: () =>
          reject(
            new MiniError(
              'NETWORK_ERROR',
              '连接失败或超时，输入已保留。请查看回执后重试。',
              true,
            ),
          ),
      });
    });
  }
  async request(method: string, path: string, body?: any, key?: string) {
    const stamp = this.generation;
    const result = await this.transport(method, path, body, key);
    if (stamp !== this.generation)
      throw new MiniError('CONNECTION_CHANGED', '连接已切换，请重新操作');
    return result;
  }
  async time() {
    const c = await this.request('GET', '/context');
    this.data.context = c;
    return c;
  }
  pending(): Pending[] {
    return this.saved('pending', []);
  }
  discard(id: string) {
    this.save(
      'pending',
      this.pending().filter((x) => x.id !== id),
    );
  }
  async mutate(path: string, body: any, method = 'POST') {
    if (!this.connected)
      throw new MiniError('NOT_CONNECTED', '先在「我的」连接个人服务');
    const prior = this.pending().find(
      (p) => p.path === path && p.method === method,
    );
    if (prior) {
      if (JSON.stringify(prior.body) === JSON.stringify(body))
        return this.retry(prior.id);
      throw new MiniError(
        'PENDING_INPUT',
        '这里还有一条输入等待确认，请先查看回执并重试，再保存新内容。',
      );
    }
    const p = {
      id: commandId(),
      method,
      path,
      body: JSON.parse(JSON.stringify(body)),
      created_at: new Date().toISOString(),
    };
    this.save('pending', [...this.pending(), p]);
    return this.retry(p.id);
  }
  async retry(id: string) {
    const p = this.pending().find((x) => x.id === id);
    if (!p) throw new MiniError('NOT_FOUND', '这条输入已处理，请刷新查看');
    if (this.running.has(id)) throw new MiniError('BUSY', '这条输入正在处理中');
    this.running.add(id);
    const stamp = this.generation;
    try {
      const result = await this.request(p.method, p.path, p.body, p.id);
      if (stamp === this.generation) {
        if (
          p.path === '/audio/transcriptions' &&
          typeof result?.text === 'string'
        ) {
          this.save(
            'draft',
            [this.saved('draft', ''), result.text].filter(Boolean).join('\n'),
          );
        }
        this.discard(id);
        if (p.path === '/chat') {
          const draft = this.saved('draft', '').trim(),
            attachments = this.saved<any[]>('attachments', []).map((a) => a.id);
          if (
            (draft === p.body.text ||
              (!draft && (p.body.attachment_ids || []).length > 0)) &&
            JSON.stringify(attachments) ===
              JSON.stringify(p.body.attachment_ids || [])
          ) {
            this.save('draft', '');
            this.save('attachments', []);
          }
        }
      }
      return result;
    } catch (e: any) {
      if (stamp === this.generation)
        this.save(
          'pending',
          this.pending().map((x) =>
            x.id === id ? { ...x, error: e.message } : x,
          ),
        );
      throw e;
    } finally {
      this.running.delete(id);
    }
  }
  async sendChat(text: string, extra: any = {}) {
    if (!text.trim() && !extra.attachment_ids?.length)
      throw new MiniError('EMPTY_INPUT', '先输入文字或选择照片');
    const c = await this.time();
    return this.mutate('/chat', {
      message_id: commandId(),
      conversation_id: 'main',
      text: text.trim() || '请根据照片估算这份食物的营养，说明估算依据。',
      captured_at: c.now_utc,
      capture_timezone: c.timezone,
      capture_local_date: c.local_date,
      offline_queued: true,
      ...extra,
    });
  }
  async upload(
    path: string,
    filePath: string,
    key = commandId(),
  ): Promise<any> {
    const settings = this.settings,
      stamp = this.generation;
    if (!settings) throw new MiniError('NOT_CONNECTED', '先连接个人服务');
    return new Promise((resolve, reject) =>
      this.platform.uploadFile({
        url: settings.base_url + '/api/v1' + path,
        filePath,
        name: 'file',
        timeout: 60000,
        header: {
          Authorization: 'Bearer ' + settings.token,
          'Idempotency-Key': key,
        },
        success: (r: any) => {
          try {
            const json = JSON.parse(r.data);
            if (stamp !== this.generation)
              throw new MiniError('CONNECTION_CHANGED', '连接已切换');
            if (r.statusCode < 200 || r.statusCode >= 300)
              throw new MiniError(
                json.error?.code || 'UPLOAD_FAILED',
                json.error?.message || '上传失败',
              );
            if (!json.data?.id)
              throw new MiniError('INVALID_RESPONSE', '文件上传返回格式不正确');
            resolve(json.data);
          } catch (e) {
            reject(
              e instanceof MiniError
                ? e
                : new MiniError('INVALID_RESPONSE', '文件上传返回格式不正确'),
            );
          }
        },
        fail: () =>
          reject(new MiniError('UPLOAD_FAILED', '文件上传失败，请重试', true)),
      }),
    );
  }
  refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    const stamp = this.generation;
    const run = (async () => {
      try {
        let c = await this.time();
        const paths = [
          '/profile',
          '/plans',
          '/workout-days',
          '/targets',
          '/messages',
          '/capabilities',
          '/memories',
        ];
        const values = await Promise.all(
          paths.map((p) => this.request('GET', p)),
        );
        let summary: any, records: any;
        for (let attempt = 0; attempt < 3; attempt++) {
          [summary, records] = await Promise.all([
            this.request('GET', '/days/' + c.local_date + '/summary'),
            this.request(
              'GET',
              '/records?local_date=' + c.local_date + '&limit=100',
            ),
          ]);
          const check = await this.time();
          if (
            check.local_date === c.local_date &&
            check.timezone === c.timezone
          ) {
            c = check;
            break;
          }
          c = check;
          summary = null;
          records = { items: [] };
        }
        if (!summary)
          throw new MiniError(
            'DATE_CHANGED',
            '日期刚刚更新，请刷新今日数据',
            true,
          );
        if (stamp !== this.generation) return;
        const [
          profile,
          plans,
          days,
          targets,
          messages,
          capabilities,
          memories,
        ] = values;
        this.data = {
          context: c,
          summary,
          records: records.items,
          profile,
          plans,
          days,
          targets,
          messages,
          capabilities,
          memories,
        };
      } catch (e) {
        if (stamp === this.generation) {
          this.data.summary = null;
          this.data.records = [];
        }
        throw e;
      }
    })();
    this.refreshing = run;
    void run
      .finally(() => {
        if (this.refreshing === run) this.refreshing = null;
      })
      .catch(() => {});
    return run;
  }
}
