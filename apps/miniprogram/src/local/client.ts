import { MiniClient, MiniError } from '../lib/client';
import { LocalCore } from './core';
import { LocalAgent } from './agent';
import { LocalMedia } from './media';
import { LocalVision, supportsVision } from './vision';

/** The existing page contract, backed by this phone rather than HTTP. */
export class LocalClient extends MiniClient {
  readonly isLocal = true;
  readonly core: LocalCore;
  readonly agent: LocalAgent;
  readonly media: LocalMedia;
  readonly vision: LocalVision;
  private localGeneration = 0;
  private activeRequests = 0;
  private localRefresh: Promise<void> | null = null;
  constructor(
    private localPlatform: any,
    private clock = () => new Date(),
  ) {
    super(localPlatform);
    this.settings = null;
    this.core = new LocalCore(localPlatform, clock);
    this.agent = new LocalAgent(this.core, localPlatform, clock);
    this.media = new LocalMedia(localPlatform, this.core);
    this.vision = new LocalVision(
      localPlatform,
      () => this.agent.modelSettings,
    );
  }
  override get connected() {
    return true;
  }
  override get storageKey() {
    return 'fitmind.local.v1.' + (this.core?.store.cacheEpoch ?? '0');
  }
  override saved<T>(name: string, fallback: T): T {
    const value = this.localPlatform.getStorageSync(
      this.storageKey + '.' + name,
    );
    return value == null || value === '' ? fallback : value;
  }
  override save(name: string, value: any) {
    try {
      this.localPlatform.setStorageSync(this.storageKey + '.' + name, value);
    } catch {
      throw new MiniError(
        'LOCAL_STORAGE_FULL',
        '手机存储写入失败，输入尚未保存。请释放空间后重试。',
        true,
      );
    }
  }
  override async connect() {
    throw new MiniError(
      'LOCAL_MODE',
      '此版本在手机本地运行，在设置中配置 AI 即可。',
    );
  }
  override disconnect() {
    this.agent.clearModel();
    this.data.capabilities = this.capabilities;
  }
  get capabilities() {
    return {
      local: true,
      text: !!this.agent.modelSettings.api_key,
      provider: this.agent.modelSettings.api_key ? 'deepseek' : 'local-rules',
      demo: false,
      vision:
        !!this.agent.modelSettings.api_key &&
        supportsVision(this.agent.modelSettings.model),
      transcription: false,
      voice_input: 'keyboard',
    };
  }
  override async request(
    method: string,
    path: string,
    body?: any,
    key?: string,
  ): Promise<any> {
    const generation = this.localGeneration;
    this.activeRequests++;
    try {
      let result: any;
      if (path === '/capabilities') result = this.capabilities;
      else if (method === 'GET' && /^\/media\/[^/]+$/.test(path))
        result = this.media.asset(decodeURIComponent(path.split('/')[2]));
      else if (method === 'POST' && path === '/nutrition/analyze') {
        const image = await this.media.imageData(body?.asset_id);
        result = await this.vision.analyze(image, body);
      } else if (path === '/messages') result = this.agent.messages();
      else if (method === 'POST' && path === '/chat')
        result = await this.agent.run(body);
      else if (method === 'POST' && /^\/messages\/[^/]+\/recover$/.test(path))
        result = await this.agent.recover(
          decodeURIComponent(path.split('/')[2]),
        );
      else result = await this.core.request(method, path, body, key);
      if (generation !== this.localGeneration)
        throw new MiniError('DATA_CHANGED', '本地数据已更换，请重新操作。');
      return result;
    } catch (error: any) {
      if (error instanceof MiniError) throw error;
      throw new MiniError(
        error.code || 'LOCAL_ERROR',
        error.message || '操作失败，请重试。',
        !!error.retryable,
      );
    } finally {
      this.activeRequests--;
    }
  }
  override async sendChat(text: string, extra: any = {}) {
    this.activeRequests++;
    try {
      return await super.sendChat(text, extra);
    } finally {
      this.activeRequests--;
    }
  }
  override async upload(
    path: string,
    filePath: string,
    key?: string,
  ): Promise<any> {
    this.activeRequests++;
    try {
      return await this.media.upload(
        path,
        filePath,
        key ?? 'image-' + this.core.store.id(),
      );
    } catch (error: any) {
      throw new MiniError(
        error.code || 'MEDIA_ERROR',
        error.message || '照片无法保存，请重试。',
        !!error.retryable,
      );
    } finally {
      this.activeRequests--;
    }
  }
  override refresh(): Promise<void> {
    if (this.localRefresh) return this.localRefresh;
    const running = super.refresh();
    this.localRefresh = running;
    void running
      .finally(() => {
        if (this.localRefresh === running) this.localRefresh = null;
      })
      .catch(() => {});
    return running;
  }
  exportBackup() {
    return this.core.exportBackup();
  }
  inspectBackup(text: string) {
    return this.core.inspectBackup(text);
  }
  private assertResetReady() {
    if (this.activeRequests || this.localRefresh)
      throw new MiniError('BUSY', '有操作正在处理，完成后再重置。');
  }
  private clearOldInputs() {
    const keys: string[] = this.localPlatform.getStorageInfoSync?.().keys ?? [];
    for (const key of keys)
      if (
        key.startsWith('fitmind.local.v1.') &&
        !key.startsWith(this.storageKey + '.')
      )
        this.localPlatform.removeStorageSync(key);
  }
  async clearLocalData() {
    this.assertResetReady();
    // Backup replacement commits the empty database before invalidating any UI input.
    await this.importBackup(
      JSON.stringify({
        format: 'fitmind.local.backup',
        version: 1,
        exported_at: this.clock().toISOString(),
        entities: [],
        operations: [],
      }),
    );
    this.clearOldInputs();
  }
  async restartOnboarding() {
    this.assertResetReady();
    const backup = JSON.parse(this.exportBackup());
    backup.onboarding_after_message_id =
      backup.entities.filter((row: any) => row.kind === 'message').at(-1)?.value
        .id || '';
    backup.entities = backup.entities.map((row: any) => {
      if (row.kind !== 'profile') return row;
      const { fitness, onboarding_status, ...profile } = row.value;
      return {
        ...row,
        value: {
          ...profile,
          version: profile.version + 1,
          onboarding_status: 'in_progress',
        },
      };
    });
    await this.importBackup(JSON.stringify(backup));
    this.clearOldInputs();
  }
  async importBackup(text: string) {
    if (this.activeRequests || this.localRefresh)
      throw new MiniError('BUSY', '有操作正在处理，完成后再导入。');
    const oldScope = this.storageKey;
    this.core.importBackup(text);
    this.localGeneration++;
    this.media.clearObsolete();
    const keys: string[] =
      this.localPlatform.getStorageInfoSync?.().keys ??
      ['pending', 'draft', 'attachments'].map((name) => oldScope + '.' + name);
    for (const key of keys.filter((key) => key.startsWith(oldScope + '.')))
      this.localPlatform.removeStorageSync(key);
    await this.refresh();
  }
  get reminder(): any | null {
    const { context, profile, days } = this.data;
    if (!context || !profile?.notifications_enabled) return null;
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: context.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(this.clock());
    const time =
      parts.find((p) => p.type === 'hour')?.value +
      ':' +
      parts.find((p) => p.type === 'minute')?.value;
    if (time < profile.reminder_time) return null;
    const tomorrow = new Date(
      Date.parse(context.local_date + 'T12:00:00Z') + 86400000,
    )
      .toISOString()
      .slice(0, 10);
    return (
      days.find(
        (day: any) => day.local_date === tomorrow && day.status === 'active',
      ) || null
    );
  }
}
