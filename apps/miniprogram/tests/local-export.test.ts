import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { migrate } from '../../api/src/db/database';
import { LocalCore } from '../src/local/core';
import { platformStore } from './local-fixtures';

it('exports an explicitly named desktop database read-only and archives chats without credentials', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fitmind-export-'));
  const database = join(directory, 'fixture.sqlite'),
    output = join(directory, 'backup.json');
  try {
    const db = new DatabaseSync(database);
    migrate(db);
    const record = {
      id: 'drink',
      version: 1,
      kind: 'water',
      amount_ml: 350,
      local_date: '2026-10-11',
      recorded_at: '2026-10-11T10:00:00Z',
      occurred_at: null,
      timezone: 'Asia/Shanghai',
      source_message_id: null,
      undone_at: null,
    };
    db.prepare('INSERT INTO entities VALUES(?,?,?,?,?,?)').run(
      'drink',
      'personal',
      'record',
      '2026-10-11',
      1,
      JSON.stringify(record),
    );
    const request = {
      message_id: 'chat',
      conversation_id: 'main',
      text: '喝水350ml',
    };
    const result = {
      message_id: 'chat',
      status: 'completed',
      assistant_text: '已记录',
      record_receipts: [],
      proposals: [],
      recommendations: [],
      affected_dates: ['2026-10-11'],
      summary: null,
      tool_errors: [],
    };
    db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?)').run(
      'chat',
      'personal',
      'main',
      JSON.stringify(request),
      JSON.stringify({
        ctx: { reference_local_date: '2026-10-11' },
        transcript: [],
        round: 0,
        pending: null,
      }),
      JSON.stringify(result),
      'completed',
      '2026-10-11T10:00:00Z',
    );
    db.close();
    writeFileSync(
      join(directory, '.env'),
      'DEEPSEEK_API_KEY=never-export-this',
    );
    const before = readFileSync(database);
    execFileSync(
      process.execPath,
      [
        fileURLToPath(
          new URL('../../../scripts/export-local-data.mjs', import.meta.url),
        ),
        '--database',
        database,
        '--out',
        output,
      ],
      { stdio: 'pipe' },
    );
    expect(readFileSync(database)).toEqual(before);
    const backup = readFileSync(output, 'utf8');
    expect(backup).not.toContain('never-export-this');
    const core = new LocalCore(platformStore());
    expect(core.inspectBackup(backup)).toMatchObject({
      counts: { record: 1, message: 1 },
      entity_count: 2,
    });
    core.importBackup(backup);
    expect(core.store.get<any>('personal', 'message', 'chat')).toMatchObject({
      status: 'completed',
      imported: true,
      result,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
