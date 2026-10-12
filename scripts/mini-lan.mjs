import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = process.argv.indexOf('--host');
const host = index >= 0 ? process.argv[index + 1] : '0.0.0.0';
if (
  !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) ||
  host.split('.').some((v) => Number(v) > 255)
)
  throw new Error('请使用本机 IPv4 地址或 0.0.0.0');
const port = Number(process.env.PORT || 8787);
const free = await new Promise((resolve) => {
  const s = createServer();
  s.once('error', () => resolve(false));
  s.listen(port, host, () => s.close(() => resolve(true)));
});
if (!free) {
  console.error(
    `${port} 端口已被占用。先停止原来的后端服务，再运行此命令；不要同时启动两个服务写同一个数据库。`,
  );
  process.exit(1);
}
console.log('手机和电脑需连接同一个路由器，电脑保持运行。');
for (const [name, list] of Object.entries(networkInterfaces()))
  for (const address of list || [])
    if (address.family === 'IPv4' && !address.internal)
      console.log(
        '小程序服务地址（' +
          name +
          '）：http://' +
          address.address +
          ':' +
          port,
      );
console.log(
  '应用访问令牌在 data/access-token；模型 API Key 仍只保留在后端 .env。',
);
const child = spawn(
  process.execPath,
  [path.join(root, 'node_modules/tsx/dist/cli.mjs'), 'src/main.ts'],
  {
    cwd: path.join(root, 'apps/api'),
    stdio: 'inherit',
    env: { ...process.env, HOST: host, PORT: String(port) },
  },
);
child.on('exit', (code) => process.exit(code || 0));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
