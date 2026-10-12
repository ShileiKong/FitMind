import type {
  CommandContext,
  CommandJournal,
  EntityStore,
} from '@fitmind/contracts';
import { DomainError, invariant } from '../../../api/src/http/errors';

export const LOCAL_DATABASE_KEY = 'fitmind.local.database.v1';
export interface LocalEntity {
  user_id: string;
  kind: string;
  value: any;
}
interface Operation {
  user_id: string;
  scope: string;
  key: string;
  payload: string;
  result: any;
}
export interface LocalSnapshot {
  version: 1;
  entities: LocalEntity[];
  operations: Operation[];
  cache_epoch?: string;
  onboarding_after_message_id?: string;
}
export interface LocalBackup extends LocalSnapshot {
  format: 'fitmind.local.backup';
  exported_at: string;
}
export interface BackupInspection {
  version: 1;
  exported_at: string;
  counts: Record<string, number>;
  entity_count: number;
}
const empty = (): LocalSnapshot => ({
  version: 1,
  entities: [],
  operations: [],
});
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const object = (value: any) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: any) => typeof value === 'string' && value.length > 0;
const CHUNK_SIZE = 128000; // At most 512 KB of UTF-8, below wx's 1 MB per-key limit.
interface Manifest {
  storage_format: 'fitmind.local.chunks';
  version: 1;
  generation: string;
  chunks: number;
  checksum: string;
}
function checksum(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++)
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}
const chunkKey = (generation: string, index: number) =>
  LOCAL_DATABASE_KEY + '.chunk.' + generation + '.' + index;

/** Stable payload identity follows the API store, including omitted optional fields. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'null';
}
function assertJson(value: unknown, ancestors = new Set<object>(), depth = 0) {
  invariant(depth <= 100, 'INVALID_DATA', '数据层级过多');
  invariant(
    typeof value !== 'function' &&
      typeof value !== 'symbol' &&
      typeof value !== 'bigint',
    'INVALID_DATA',
    '数据必须可保存为 JSON',
  );
  if (typeof value === 'number')
    invariant(Number.isFinite(value), 'INVALID_DATA', '数据包含无效数值');
  if (value && typeof value === 'object') {
    invariant(!ancestors.has(value), 'INVALID_DATA', '数据不能循环引用');
    invariant(
      Array.isArray(value) ||
        Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null,
      'INVALID_DATA',
      '数据必须是普通 JSON 对象',
    );
    ancestors.add(value);
    for (const nested of Object.values(value))
      assertJson(nested, ancestors, depth + 1);
    ancestors.delete(value);
  }
}
function validateSnapshot(value: any): LocalSnapshot {
  invariant(
    object(value) && value.version === 1,
    'STORAGE_VERSION',
    '本地数据版本不受支持',
  );
  invariant(
    Array.isArray(value.entities) && Array.isArray(value.operations),
    'STORAGE_CORRUPT',
    '本地数据损坏，请从有效备份恢复',
  );
  invariant(
    Object.keys(value).every((key) =>
      [
        'version',
        'entities',
        'operations',
        'cache_epoch',
        'onboarding_after_message_id',
        'format',
        'exported_at',
      ].includes(key),
    ),
    'STORAGE_CORRUPT',
    '本地数据结构损坏',
  );
  invariant(
    value.cache_epoch === undefined || text(value.cache_epoch),
    'STORAGE_CORRUPT',
    '本地缓存版本损坏',
  );
  invariant(
    value.onboarding_after_message_id === undefined ||
      (typeof value.onboarding_after_message_id === 'string' &&
        value.onboarding_after_message_id.length <= 300),
    'STORAGE_CORRUPT',
    '首次引导记录边界无效',
  );
  const entityIds = new Set<string>();
  for (const row of value.entities) {
    invariant(
      object(row) &&
        text(row.user_id) &&
        text(row.kind) &&
        object(row.value) &&
        text(row.value.id) &&
        Number.isInteger(row.value.version) &&
        row.value.version >= 1 &&
        Object.keys(row).every((key) =>
          ['user_id', 'kind', 'value'].includes(key),
        ),
      'STORAGE_CORRUPT',
      '本地数据记录损坏',
    );
    const identity = canonical([row.user_id, row.kind, row.value.id]);
    invariant(
      !entityIds.has(identity),
      'STORAGE_CORRUPT',
      '本地数据包含重复记录',
    );
    entityIds.add(identity);
  }
  const operationIds = new Set<string>();
  for (const row of value.operations) {
    invariant(
      object(row) &&
        text(row.user_id) &&
        text(row.scope) &&
        text(row.key) &&
        typeof row.payload === 'string' &&
        'result' in row &&
        Object.keys(row).every((key) =>
          ['user_id', 'scope', 'key', 'payload', 'result'].includes(key),
        ),
      'STORAGE_CORRUPT',
      '本地请求回执损坏',
    );
    const identity = canonical([row.user_id, row.scope, row.key]);
    invariant(
      !operationIds.has(identity),
      'STORAGE_CORRUPT',
      '本地数据包含重复请求',
    );
    operationIds.add(identity);
  }
  assertJson(value);
  return clone({
    version: 1,
    entities: value.entities,
    operations: value.operations,
    ...(value.cache_epoch === undefined
      ? {}
      : { cache_epoch: value.cache_epoch }),
    ...(value.onboarding_after_message_id === undefined
      ? {}
      : { onboarding_after_message_id: value.onboarding_after_message_id }),
  });
}

/** One wx storage write commits data, idempotency, and command receipts together. */
export class LocalStore implements EntityStore {
  private state: LocalSnapshot;
  private depth = 0;
  private serial = 0;
  private mutations = 0;
  private readError: DomainError | null = null;
  private manifest: Manifest | null = null;
  constructor(
    private platform: any,
    private clock = () => new Date(),
  ) {
    this.state = empty();
    let saved: unknown;
    try {
      saved = platform.getStorageSync(LOCAL_DATABASE_KEY);
    } catch {
      this.readError = new DomainError(
        'STORAGE_READ_FAILED',
        '无法读取手机本地数据',
        500,
        true,
      );
      return;
    }
    if (saved !== undefined && saved !== null && saved !== '') {
      try {
        let parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
        if (parsed?.storage_format === 'fitmind.local.chunks') {
          invariant(
            parsed.version === 1 &&
              text(parsed.generation) &&
              /^[a-zA-Z0-9_-]+$/.test(parsed.generation) &&
              Number.isInteger(parsed.chunks) &&
              parsed.chunks >= 1 &&
              parsed.chunks <= 200 &&
              text(parsed.checksum),
            'STORAGE_CORRUPT',
            '本地分块清单损坏',
          );
          this.manifest = parsed;
          let serialized = '';
          for (let index = 0; index < parsed.chunks; index++) {
            const part = platform.getStorageSync(
              chunkKey(parsed.generation, index),
            );
            invariant(
              typeof part === 'string' && part.length > 0,
              'STORAGE_CORRUPT',
              '本地数据分块缺失',
            );
            serialized += part;
          }
          invariant(
            checksum(serialized) === parsed.checksum,
            'STORAGE_CORRUPT',
            '本地数据分块损坏',
          );
          parsed = JSON.parse(serialized);
        }
        this.state = validateSnapshot(parsed);
      } catch (error) {
        this.readError =
          error instanceof DomainError && error.code === 'STORAGE_VERSION'
            ? error
            : new DomainError(
                'STORAGE_CORRUPT',
                '手机本地数据损坏，请导入有效备份恢复',
                500,
              );
      }
    }
    if (!this.readError) this.cleanChunks(this.manifest?.generation);
  }
  get cacheEpoch() {
    return this.state.cache_epoch ?? '0';
  }
  get onboardingAfterMessageId() {
    return this.state.onboarding_after_message_id;
  }
  private assertReadable() {
    if (this.readError) throw this.readError;
  }
  private removeKey(key: string) {
    try {
      this.platform.removeStorageSync?.(key);
    } catch {
      /* Old chunks are safe to clean on the next open. */
    }
  }
  private cleanChunks(keepGeneration?: string) {
    try {
      for (const key of this.platform.getStorageInfoSync?.().keys ?? [])
        if (
          key.startsWith(LOCAL_DATABASE_KEY + '.chunk.') &&
          (!keepGeneration ||
            !key.startsWith(
              LOCAL_DATABASE_KEY + '.chunk.' + keepGeneration + '.',
            ))
        )
          this.removeKey(key);
    } catch {
      /* Cleanup must never turn a committed write into a failed write. */
    }
  }
  private persist(snapshot: LocalSnapshot) {
    const serialized = JSON.stringify(snapshot);
    const oldManifest = this.manifest;
    const staged: string[] = [];
    let manifest: Manifest | null = null;
    try {
      if (serialized.length <= CHUNK_SIZE)
        this.platform.setStorageSync(LOCAL_DATABASE_KEY, serialized);
      else {
        const generation = this.id();
        const chunks = Math.ceil(serialized.length / CHUNK_SIZE);
        for (let index = 0; index < chunks; index++) {
          const key = chunkKey(generation, index);
          staged.push(key);
          this.platform.setStorageSync(
            key,
            serialized.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE),
          );
        }
        manifest = {
          storage_format: 'fitmind.local.chunks',
          version: 1,
          generation,
          chunks,
          checksum: checksum(serialized),
        };
        this.platform.setStorageSync(
          LOCAL_DATABASE_KEY,
          JSON.stringify(manifest),
        );
      }
    } catch {
      for (const key of staged) this.removeKey(key);
      throw new DomainError(
        'STORAGE_WRITE_FAILED',
        '手机本地保存失败，请检查剩余空间后重试',
        500,
        true,
      );
    }
    this.manifest = manifest;
    if (oldManifest)
      for (let index = 0; index < oldManifest.chunks; index++)
        this.removeKey(chunkKey(oldManifest.generation, index));
  }
  transaction<T>(fn: () => T): T {
    this.assertReadable();
    const previous = this.state;
    const previousMutations = this.mutations;
    this.state = clone(previous);
    this.depth++;
    try {
      const result = fn();
      invariant(
        !(result && typeof (result as any).then === 'function'),
        'ASYNC_TRANSACTION',
        '本地事务回调必须同步执行',
      );
      if (this.depth === 1 && this.mutations !== previousMutations)
        this.persist(this.state);
      return result;
    } catch (error) {
      this.state = previous;
      this.mutations = previousMutations;
      throw error;
    } finally {
      this.depth--;
    }
  }
  get<T = any>(user: string, kind: string, id: string): T {
    this.assertReadable();
    const row = this.state.entities.find(
      (row) => row.user_id === user && row.kind === kind && row.value.id === id,
    );
    invariant(row, 'NOT_FOUND', '记录不存在', 404);
    return clone(row.value);
  }
  list<T = any>(user: string, kind: string): T[] {
    this.assertReadable();
    return this.state.entities
      .filter((row) => row.user_id === user && row.kind === kind)
      .map((row) => clone(row.value))
      .reverse();
  }
  put<T extends { id: string; version: number }>(
    user: string,
    kind: string,
    value: T,
  ): T {
    if (!this.depth) return this.transaction(() => this.put(user, kind, value));
    invariant(
      text(user) &&
        text(kind) &&
        object(value) &&
        text(value.id) &&
        Number.isInteger(value.version) &&
        value.version >= 1,
      'INVALID_ENTITY',
      '记录编号或版本无效',
    );
    assertJson(value);
    const saved = clone(value);
    const existing = this.state.entities.find(
      (row) =>
        row.user_id === user && row.kind === kind && row.value.id === value.id,
    );
    if (existing) existing.value = saved;
    else this.state.entities.push({ user_id: user, kind, value: saved });
    this.mutations++;
    return clone(saved);
  }
  mutate<T>(
    ctx: CommandContext,
    scope: string,
    payload: unknown,
    fn: () => T,
  ): T {
    invariant(
      ctx.idempotency_key,
      'IDEMPOTENCY_REQUIRED',
      '写入必须提供 Idempotency-Key',
    );
    assertJson(payload);
    return this.transaction(() => {
      const identity = canonical(payload);
      const prior = this.state.operations.find(
        (row) =>
          row.user_id === ctx.user_id &&
          row.scope === scope &&
          row.key === ctx.idempotency_key,
      );
      if (prior) {
        invariant(
          prior.payload === identity,
          'IDEMPOTENCY_CONFLICT',
          '同一请求 ID 的内容不同',
          409,
        );
        this.journal(ctx, prior.result);
        return clone(prior.result) as T;
      }
      const result = fn();
      invariant(
        !(result && typeof (result as any).then === 'function'),
        'ASYNC_TRANSACTION',
        '本地事务回调必须同步执行',
      );
      assertJson(result);
      this.state.operations.push({
        user_id: ctx.user_id,
        scope,
        key: ctx.idempotency_key,
        payload: identity,
        result: clone(result),
      });
      this.mutations++;
      this.journal(ctx, result);
      return clone(result) as T;
    });
  }
  journal(
    ctx: CommandContext & { journal?: CommandJournal },
    result: unknown,
  ): void {
    const journal = ctx.journal;
    if (!journal) return;
    if (!this.depth) return this.transaction(() => this.journal(ctx, result));
    invariant(
      text(journal.message_id) &&
        Number.isInteger(journal.slot) &&
        journal.slot >= 0 &&
        typeof journal.payload === 'string',
      'INVALID_JOURNAL',
      '工具日志无效',
    );
    const id = journal.message_id + ':' + journal.slot;
    if (
      this.state.entities.some(
        (row) =>
          row.user_id === ctx.user_id &&
          row.kind === 'command' &&
          row.value.id === id,
      )
    )
      return;
    this.put(ctx.user_id, 'command', { id, version: 1, ...journal, result });
  }
  id() {
    // No Node crypto, browser crypto, or external service is required on the phone.
    return (
      'local-' +
      this.clock().getTime().toString(36) +
      '-' +
      (++this.serial).toString(36) +
      '-' +
      Math.random().toString(36).slice(2) +
      Math.random().toString(36).slice(2)
    );
  }
  snapshot(): LocalSnapshot {
    this.assertReadable();
    return clone(this.state);
  }
  exportBackup(): string {
    const { cache_epoch, ...data } = this.snapshot();
    return JSON.stringify(
      {
        format: 'fitmind.local.backup',
        exported_at: this.clock().toISOString(),
        ...data,
      },
      null,
      2,
    );
  }
  inspectBackup(text: string): BackupInspection {
    const backup = this.parseBackup(text);
    const counts: Record<string, number> = Object.create(null);
    for (const row of backup.entities)
      counts[row.kind] = (counts[row.kind] ?? 0) + 1;
    return {
      version: 1,
      exported_at: backup.exported_at,
      counts,
      entity_count: backup.entities.length,
    };
  }
  parseBackup(text: string): LocalBackup {
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new DomainError('INVALID_BACKUP', '备份必须是有效 JSON 文件');
    }
    invariant(
      object(parsed) && parsed.version === 1,
      'BACKUP_VERSION',
      '备份版本不受支持',
    );
    invariant(
      parsed.format === 'fitmind.local.backup' &&
        typeof parsed.exported_at === 'string' &&
        Number.isFinite(Date.parse(parsed.exported_at)) &&
        parsed.cache_epoch === undefined,
      'INVALID_BACKUP',
      '备份格式或导出时间无效',
    );
    try {
      return {
        ...validateSnapshot(parsed),
        format: parsed.format,
        exported_at: parsed.exported_at,
      };
    } catch {
      throw new DomainError('INVALID_BACKUP', '备份数据结构或记录无效');
    }
  }
  importBackup(text: string): BackupInspection {
    const backup = this.parseBackup(text);
    const inspection = this.inspectBackup(text);
    invariant(
      this.depth === 0,
      'IMPORT_IN_TRANSACTION',
      '请在当前事务完成后导入备份',
    );
    const replacement = { ...validateSnapshot(backup), cache_epoch: this.id() };
    this.persist(replacement);
    this.state = replacement;
    this.readError = null;
    return inspection;
  }
}
