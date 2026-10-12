import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { CommandContext } from '@fitmind/contracts';
import { invariant } from '../http/errors.js';
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
export class Store {
  private depth = 0;
  constructor(public db: DatabaseSync) {}
  transaction<T>(fn: () => T): T {
    if (this.depth) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    this.depth++;
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    } finally {
      this.depth--;
    }
  }
  get<T = any>(user: string, kind: string, id: string): T {
    const row = this.db
      .prepare('SELECT data FROM entities WHERE id=? AND user_id=? AND kind=?')
      .get(id, user, kind) as any;
    invariant(row, 'NOT_FOUND', '记录不存在', 404);
    return JSON.parse(row.data);
  }
  list<T = any>(user: string, kind: string): T[] {
    return (
      this.db
        .prepare(
          'SELECT data FROM entities WHERE user_id=? AND kind=? ORDER BY rowid DESC',
        )
        .all(user, kind) as any[]
    ).map((r) => JSON.parse(r.data));
  }
  put<T extends { id: string; version: number }>(
    user: string,
    kind: string,
    value: T,
  ) {
    const data = JSON.stringify(value);
    this.db
      .prepare(
        'INSERT INTO entities VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET local_date=excluded.local_date,version=excluded.version,data=excluded.data',
      )
      .run(
        value.id,
        user,
        kind,
        (value as any).local_date ?? null,
        value.version,
        data,
      );
    this.db
      .prepare('INSERT OR REPLACE INTO revisions VALUES(?,?,?)')
      .run(value.id, value.version, data);
    return value;
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
    return this.transaction(() => {
      const p = canonical(payload);
      const prior = this.db
        .prepare(
          'SELECT payload,result FROM operations WHERE user_id=? AND scope=? AND op_key=?',
        )
        .get(ctx.user_id, scope, ctx.idempotency_key) as any;
      if (prior) {
        invariant(
          prior.payload === p,
          'IDEMPOTENCY_CONFLICT',
          '同一请求 ID 的内容不同',
          409,
        );
        const r = JSON.parse(prior.result);
        this.journal(ctx, r);
        return r;
      }
      const r = fn();
      this.db
        .prepare('INSERT INTO operations VALUES(?,?,?,?,?)')
        .run(ctx.user_id, scope, ctx.idempotency_key, p, JSON.stringify(r));
      this.journal(ctx, r);
      return r;
    });
  }
  journal(ctx: any, result: any) {
    const j = ctx.journal;
    if (j)
      this.db
        .prepare('INSERT OR IGNORE INTO commands VALUES(?,?,?,?)')
        .run(j.message_id, j.slot, j.payload, JSON.stringify(result));
  }
  id() {
    return randomUUID();
  }
}
