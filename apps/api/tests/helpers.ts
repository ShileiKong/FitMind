import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
export async function makeHarness(options: any = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fitmind-test-'));
  let db = new DatabaseSync(join(dir, 'test.sqlite'));
  const clock = options.clock ?? (() => new Date('2026-10-11T02:00:00.000Z'));
  const deps = () => ({
    db,
    clock,
    access_token: 'test-token',
    media_root: dir,
    providers: options.providers,
  });
  let app = await createApp(deps());
  const h: any = {
    app,
    services: app.services,
    ctx: {
      user_id: 'personal',
      request_id: 'test',
      idempotency_key: 'test-key',
      now_utc: clock().toISOString(),
      timezone: 'Asia/Shanghai',
      reference_local_date: '2026-10-11',
    },
    close: async () => {
      await app.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
    reopen: async () => {
      await app.close();
      db.close();
      db = new DatabaseSync(join(dir, 'test.sqlite'));
      app = await createApp(deps());
      h.app = app;
      h.services = app.services;
      return h;
    },
  };
  return h;
}
