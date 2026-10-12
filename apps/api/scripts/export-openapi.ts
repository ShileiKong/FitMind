import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createApp } from '../src/app.js';
const temporary = mkdtempSync(join(tmpdir(), 'fitmind-openapi-'));
const db = new DatabaseSync(':memory:');
const app = await createApp({
  db,
  clock: () => new Date(),
  access_token: 'export-only',
  media_root: temporary,
});
try {
  await app.ready();
  const output = resolve('../../docs/openapi.json');
  mkdirSync(resolve('../../docs'), { recursive: true });
  writeFileSync(output, JSON.stringify(app.swagger(), null, 2) + '\n');
  console.log('Exported ' + output);
} finally {
  await app.close();
  db.close();
  if (!temporary.startsWith(join(tmpdir(), 'fitmind-openapi-')))
    throw new Error('Unexpected temporary path');
  rmSync(temporary, { recursive: true });
}
