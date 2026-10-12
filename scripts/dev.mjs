import { spawn, execFileSync } from 'node:child_process';
import { existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
const root = fileURLToPath(new URL('../', import.meta.url)),
  require = createRequire(import.meta.url);
const envPath = resolve(root, 'apps/api/.env');
if (!existsSync(envPath)) {
  copyFileSync(resolve(root, '.env.example'), envPath);
  console.log('Created apps/api/.env; add model credentials there.');
}
const children = [
  spawn(
    process.execPath,
    [require.resolve('tsx/cli'), 'watch', 'src/main.ts'],
    { cwd: resolve(root, 'apps/api'), stdio: 'inherit', env: process.env },
  ),
  spawn(
    process.execPath,
    [
      resolve(require.resolve('expo/package.json'), '../bin/cli'),
      'start',
      '--web',
      '--port',
      process.env.WEB_PORT ?? '8081',
    ],
    { cwd: resolve(root, 'apps/mobile'), stdio: 'inherit', env: process.env },
  ),
];
let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children)
    if (child.pid && !child.killed) {
      if (process.platform === 'win32') {
        try {
          execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true,
          });
        } catch {}
      } else child.kill('SIGTERM');
    }
  process.exitCode = code;
}
process.on('SIGINT', () => close());
process.on('SIGTERM', () => close());
for (const child of children) {
  child.on('error', (error) => {
    console.error(error.message);
    close(1);
  });
  child.on('exit', (code) => close(code ?? 1));
}
