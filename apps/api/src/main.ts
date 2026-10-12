import { config } from './config.js';
import { openDatabase } from './db/database.js';
import { createApp } from './app.js';
import { resolve } from 'node:path';
const c = config();
const db = openDatabase(resolve(c.data, 'fitmind.sqlite'));
const app = await createApp({
  db,
  clock: () => new Date(),
  access_token: c.token,
  media_root: resolve(c.data, 'media'),
});
await app.listen({ port: c.port, host: c.host });
console.log(
  'FitMind API: http://' +
    c.host +
    ':' +
    c.port +
    ' — access token file: ' +
    resolve(c.data, 'access-token'),
);
process.on('SIGINT', async () => {
  await app.close();
  db.close();
  process.exit(0);
});
