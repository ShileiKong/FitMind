import { agentRequestTimeout, type ApiClient } from '../api/client';
export interface PendingInput {
  idempotency_key: string;
  message_id: string | null;
  captured_at: string;
  capture_timezone: string;
  capture_local_date: string;
  workout_session_id: string | null;
  method: string;
  path: string;
  body: any;
  local_attachments: any[];
  last_error?: { code: string; message: string; retryable: boolean };
}
export class Outbox {
  private serial: Promise<any> = Promise.resolve();
  constructor(
    private store: any,
    private key: string,
    private prepare?: (
      client: ApiClient,
      item: PendingInput,
    ) => Promise<PendingInput>,
  ) {}
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const job = this.serial.then(fn);
    this.serial = job.catch(() => {});
    return job;
  }
  async list(): Promise<PendingInput[]> {
    return (await this.store.get(this.key)) ?? [];
  }
  async result(key: string) {
    return (await this.store.get(this.key + '.receipts'))?.[key] ?? null;
  }
  async acknowledged(key: string) {
    const result = await this.result(key);
    return result?.message_id && result.status !== 'completed' ? null : result;
  }
  enqueue(item: PendingInput) {
    return this.exclusive(async () => {
      const all = await this.list();
      const same = all.find((x) => x.idempotency_key === item.idempotency_key);
      if (same) return same;
      await this.store.set(this.key, [...all, item]);
      return item;
    });
  }
  remove(key: string) {
    return this.exclusive(async () => {
      await this.store.set(
        this.key,
        (await this.list()).filter((x) => x.idempotency_key !== key),
      );
    });
  }
  flush(client: ApiClient) {
    return this.exclusive(async () => {
      const completed: any[] = [];
      let all = await this.list();
      while (all.length) {
        let item = all[0];
        try {
          if (this.prepare && item.local_attachments.length) {
            item = await this.prepare(client, item);
            all[0] = item;
            await this.store.set(this.key, all);
          }
          const r = await client.request(item.method, item.path, item.body, {
            idempotency_key: item.idempotency_key,
            timeout_ms: agentRequestTimeout(item.method, item.path) ?? 30000,
          });
          completed.push({
            key: item.idempotency_key,
            path: item.path,
            body: item.body,
            result: r.data,
          });
          const receipts = (await this.store.get(this.key + '.receipts')) ?? {};
          receipts[item.idempotency_key] = r.data;
          const entries = Object.entries(receipts).slice(-100);
          await this.store.set(
            this.key + '.receipts',
            Object.fromEntries(entries),
          );
          if (
            item.path === '/chat' &&
            r.data.status !== 'completed' &&
            r.data.error?.retryable !== false
          ) {
            all[0] = {
              ...item,
              last_error: r.data.error ?? {
                code: 'MODEL_PENDING',
                message: '消息待恢复',
                retryable: true,
              },
            };
            await this.store.set(this.key, all);
            break;
          }
          all = all.slice(1);
          await this.store.set(this.key, all);
        } catch (e: any) {
          all[0] = {
            ...item,
            last_error: {
              code: e.code ?? 'SYNC_ERROR',
              message: e.message,
              retryable: e.retryable ?? true,
            },
          };
          await this.store.set(this.key, all);
          break;
        }
      }
      return { completed, pending: all };
    });
  }
}
