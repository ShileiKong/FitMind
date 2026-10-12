import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const argument = (name) => {
  const index = process.argv.indexOf('--' + name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const databasePath = argument('database');
if (!databasePath)
  throw new Error(
    '请明确指定数据库：node scripts/export-local-data.mjs --database 路径/fitmind.sqlite --out data/phone-backup.json',
  );
const source = resolve(databasePath);
const output = resolve(argument('out') || 'data/phone-backup.json');
if (output === source) throw new Error('备份输出不能覆盖源数据库');

// No config/.env imports, migrations, PRAGMAs, access tokens, or model settings.
const db = new DatabaseSync(source, { readOnly: true });
let backup;
try {
  db.exec('BEGIN');
  const hasTable = (name) =>
    !!db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(name);
  if (!hasTable('entities')) throw new Error('这不是有效的 FitMind 数据库');
  const entities = db
    .prepare('SELECT user_id,kind,data FROM entities ORDER BY rowid')
    .all()
    .map((row) => ({
      user_id: row.user_id,
      kind: row.kind,
      value: JSON.parse(row.data),
    }));
  const operations = hasTable('operations')
    ? db
        .prepare(
          'SELECT user_id,scope,op_key,payload,result FROM operations ORDER BY rowid',
        )
        .all()
        .map((row) => ({
          user_id: row.user_id,
          scope: row.scope,
          key: row.op_key,
          payload: row.payload,
          result: JSON.parse(row.result),
        }))
    : [];
  if (hasTable('messages')) {
    for (const row of db
      .prepare('SELECT * FROM messages ORDER BY rowid')
      .all()) {
      const request = JSON.parse(row.request),
        saved = JSON.parse(row.context);
      let result = row.result
        ? JSON.parse(row.result)
        : {
            message_id: row.id,
            status: 'failed',
            assistant_text: '旧版对话已导入。请查看记录后发送新消息继续。',
            record_receipts: [],
            proposals: [],
            recommendations: [],
            affected_dates: [],
            summary: null,
            tool_errors: [],
          };
      if (row.state !== 'completed')
        result = {
          ...result,
          error: {
            code: 'IMPORTED_MESSAGE',
            message: '旧版未完成对话已归档，请发送新消息继续。',
            retryable: false,
          },
        };
      entities.push({
        user_id: row.user_id,
        kind: 'message',
        value: {
          id: row.id,
          version: 1,
          created_at: row.created_at,
          request,
          ctx: saved.ctx ?? {},
          context_snapshot: saved.context_snapshot ?? {},
          prior_snapshot: [],
          transcript: saved.transcript ?? [],
          round: saved.round ?? 0,
          pending: null,
          // The desktop and phone command slots differ. Archive imports to prevent replay.
          status: 'completed',
          result,
          mode: 'rules',
          imported: true,
        },
      });
    }
  }
  backup = {
    format: 'fitmind.local.backup',
    version: 1,
    exported_at: new Date().toISOString(),
    entities,
    operations,
  };
  db.exec('COMMIT');
} finally {
  db.close();
}
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(backup, null, 2) + '\n', {
  flag: 'wx',
  mode: 0o600,
});
console.log('已只读导出 ' + backup.entities.length + ' 条记录：' + output);
