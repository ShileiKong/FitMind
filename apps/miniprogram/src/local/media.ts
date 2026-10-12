import type { MediaAsset } from '@fitmind/contracts';
import { DomainError, invariant } from '../../../api/src/http/errors';
import type { LocalCore } from './core';

const MAX_IMAGE = 5 * 1024 * 1024;
const CACHE_BYTES = 40 * 1024 * 1024;
const CACHE_COUNT = 30;
const CACHE_PREFIX = 'fitmind.local.media.v1.';
const safeId = (id: unknown): id is string =>
  typeof id === 'string' && /^[a-zA-Z0-9_-]{1,150}$/.test(id);
interface CacheEntry {
  id: string;
  key: string;
  source: string;
  size: number;
}
export interface LocalImage extends MediaAsset {
  local_date: string;
}

function imageMime(bytes: Uint8Array): string {
  const matches = (pattern: number[], offset = 0) =>
    pattern.every((v, i) => bytes[offset + i] === v);
  if (matches([137, 80, 78, 71, 13, 10, 26, 10])) return 'image/png';
  if (matches([255, 216, 255])) return 'image/jpeg';
  if (
    matches([71, 73, 70, 56]) &&
    [55, 57].includes(bytes[4]) &&
    bytes[5] === 97
  )
    return 'image/gif';
  if (matches([82, 73, 70, 70]) && matches([87, 69, 66, 80], 8))
    return 'image/webp';
  throw new DomainError(
    'IMAGE_FORMAT',
    '图片格式不支持，请选择 JPEG、PNG、GIF 或 WebP 图片。',
  );
}

/** Managed phone files; business backups contain only inert metadata. */
export class LocalMedia {
  private uploads = new Map<
    string,
    { source: string; promise: Promise<LocalImage> }
  >();
  constructor(
    private platform: any,
    private core: LocalCore,
  ) {}
  private get cacheKey() {
    return CACHE_PREFIX + this.core.store.cacheEpoch;
  }
  private get root() {
    invariant(
      typeof this.platform.env?.USER_DATA_PATH === 'string',
      'MEDIA_UNAVAILABLE',
      '当前环境不能保存照片，请在微信小程序中使用。',
    );
    return (
      this.platform.env.USER_DATA_PATH.replace(/\/$/, '') + '/fitmind-media'
    );
  }
  private file(id: string) {
    invariant(safeId(id), 'INVALID_IMAGE', '照片编号无效');
    return this.root + '/' + id + '.img';
  }
  private get fs() {
    invariant(
      this.platform.getFileSystemManager,
      'MEDIA_UNAVAILABLE',
      '当前环境不能保存照片，请在微信小程序中使用。',
    );
    return this.platform.getFileSystemManager();
  }
  private entries(key = this.cacheKey): CacheEntry[] {
    const value = this.platform.getStorageSync(key);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (v: any) =>
        safeId(v?.id) &&
        typeof v.key === 'string' &&
        typeof v.source === 'string' &&
        Number.isInteger(v.size) &&
        v.size > 0 &&
        v.size <= MAX_IMAGE,
    );
  }
  private read(path: string): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      try {
        this.fs.readFile({
          filePath: path,
          success: (r: any) => {
            // wx returns buffers from a native context; instanceof can be false.
            if (
              Object.prototype.toString.call(r.data) === '[object ArrayBuffer]'
            )
              resolve(r.data);
            else
              reject(
                new DomainError('IMAGE_READ', '无法读取照片，请重新选择。'),
              );
          },
          fail: () =>
            reject(new DomainError('IMAGE_READ', '照片已失效，请重新选择。')),
        });
      } catch {
        reject(new DomainError('IMAGE_READ', '无法读取照片，请重新选择。'));
      }
    });
  }
  private remove(id: string) {
    try {
      this.fs.unlinkSync(this.file(id));
    } catch {
      /* Best effort for a managed file only. */
    }
  }
  upload(path: string, source: string, key: string): Promise<LocalImage> {
    invariant(
      path === '/media/images',
      'MEDIA_UNSUPPORTED',
      '本地语音请使用手机键盘听写。',
    );
    invariant(
      typeof source === 'string' &&
        source.length > 0 &&
        typeof key === 'string' &&
        key.length > 0 &&
        key.length <= 300,
      'INVALID_IMAGE',
      '请选择照片后重试。',
    );
    const existing = this.entries().find((e) => e.key === key);
    if (existing) {
      invariant(
        existing.source === source,
        'IDEMPOTENCY_CONFLICT',
        '重复请求对应了另一张照片，请重新选择。',
      );
      return Promise.resolve(
        this.core.store.get<LocalImage>('personal', 'media', existing.id),
      );
    }
    const running = this.uploads.get(key);
    if (running) {
      invariant(
        running.source === source,
        'IDEMPOTENCY_CONFLICT',
        '重复请求对应了另一张照片，请重新选择。',
      );
      return running.promise;
    }
    const promise = this.stage(source, key);
    this.uploads.set(key, { source, promise });
    void promise.finally(() => this.uploads.delete(key)).catch(() => {});
    return promise;
  }
  private async stage(source: string, key: string): Promise<LocalImage> {
    // Capture before file IO so midnight cannot move the meal to tomorrow.
    const context = this.core.context();
    const buffer = await this.read(source);
    invariant(
      buffer.byteLength > 0 && buffer.byteLength <= MAX_IMAGE,
      'IMAGE_SIZE',
      '图片太大或为空，请选择小于 5 MB 的图片。',
    );
    const mime = imageMime(new Uint8Array(buffer));
    const asset: LocalImage = {
      id: this.core.store.id(),
      kind: 'image',
      mime_type: mime,
      size_bytes: buffer.byteLength,
      created_at: context.now_utc,
      local_date: context.local_date,
      version: 1,
    };
    try {
      this.fs.mkdirSync(this.root, true);
    } catch {
      /* Existing directory is expected. Copy reports other failures. */
    }
    await new Promise<void>((resolve, reject) => {
      try {
        this.fs.copyFile({
          srcPath: source,
          destPath: this.file(asset.id),
          success: () => resolve(),
          fail: () =>
            reject(
              new DomainError(
                'MEDIA_STORAGE',
                '手机空间不足或照片无法保存，请释放空间后重试。',
                500,
                true,
              ),
            ),
        });
      } catch {
        reject(
          new DomainError(
            'MEDIA_STORAGE',
            '照片无法保存，请重新选择。',
            500,
            true,
          ),
        );
      }
    });
    const previous = this.entries();
    const all = [
      ...previous,
      { id: asset.id, key, source, size: asset.size_bytes },
    ];
    const evicted: CacheEntry[] = [];
    while (
      all.length > CACHE_COUNT ||
      all.reduce((sum, e) => sum + e.size, 0) > CACHE_BYTES
    )
      evicted.push(all.shift()!);
    try {
      this.platform.setStorageSync(this.cacheKey, all);
      this.core.store.put('personal', 'media', asset);
    } catch {
      try {
        this.platform.setStorageSync(this.cacheKey, previous);
      } catch {
        /* Failed quota write leaves no confirmed business mutation. */
      }
      this.remove(asset.id);
      throw new DomainError(
        'MEDIA_STORAGE',
        '照片尚未保存，手机存储写入失败，请释放空间后重试。',
        500,
        true,
      );
    }
    for (const old of evicted) this.remove(old.id);
    return asset;
  }
  asset(id: string): LocalImage & { preview_path: string } {
    invariant(
      this.entries().some((e) => e.id === id),
      'IMAGE_MISSING',
      '照片缓存已清理或备份不包含原图，请重新拍照。',
    );
    const asset = this.core.store.get<LocalImage>('personal', 'media', id);
    invariant(asset.kind === 'image', 'NOT_IMAGE', '请选择照片');
    return { ...asset, preview_path: this.file(id) };
  }
  async imageData(id: string) {
    const asset = this.asset(id);
    const buffer = await this.read(asset.preview_path);
    invariant(
      buffer.byteLength === asset.size_bytes && buffer.byteLength <= MAX_IMAGE,
      'IMAGE_CHANGED',
      '照片文件已变化，请重新选择。',
    );
    const mime = imageMime(new Uint8Array(buffer));
    invariant(
      mime === asset.mime_type,
      'IMAGE_CHANGED',
      '照片文件已变化，请重新选择。',
    );
    return (
      'data:' + mime + ';base64,' + this.platform.arrayBufferToBase64(buffer)
    );
  }
  clearObsolete() {
    for (const key of this.platform.getStorageInfoSync?.().keys ?? []) {
      if (!key.startsWith(CACHE_PREFIX) || key === this.cacheKey) continue;
      for (const entry of this.entries(key)) this.remove(entry.id);
      try {
        this.platform.removeStorageSync(key);
      } catch {
        /* Cleanup can retry after a later import. */
      }
    }
  }
}
