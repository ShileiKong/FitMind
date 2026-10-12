import 'dotenv/config';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
export function config() {
  const data = resolve(process.env.DATA_DIR ?? '../../data');
  mkdirSync(data, { recursive: true });
  const path = resolve(data, 'access-token');
  const configured = process.env.APP_ACCESS_TOKEN?.trim();
  const token =
    configured ||
    (existsSync(path)
      ? readFileSync(path, 'utf8').trim()
      : randomBytes(24).toString('hex'));
  if (!existsSync(path) || readFileSync(path, 'utf8').trim() !== token)
    writeFileSync(path, token, { mode: 0o600 });
  return {
    data,
    token,
    port: Number(process.env.PORT ?? 8787),
    host: process.env.HOST ?? '127.0.0.1',
  };
}
