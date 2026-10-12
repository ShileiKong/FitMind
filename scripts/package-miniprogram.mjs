import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { zipSync } from 'fflate';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = process.argv.indexOf('--out');
const output = path.resolve(
  at >= 0
    ? process.argv[at + 1]
    : path.join(root, 'data/releases/FitMind-微信体验版.zip'),
);
const buildArgs = process.argv
  .slice(2)
  .filter((_, i, a) => a[i] !== '--out' && a[i - 1] !== '--out');
const result = spawnSync(
  process.execPath,
  [path.join(root, 'apps/miniprogram/scripts/build.mjs'), ...buildArgs],
  { cwd: root, stdio: 'inherit' },
);
if (result.status !== 0) process.exit(result.status || 1);
const dist = path.join(root, 'apps/miniprogram/dist');
async function all(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) =>
        e.isDirectory()
          ? all(path.join(dir, e.name))
          : [path.join(dir, e.name)],
      ),
    )
  ).flat();
}
const zip = {};
for (const file of await all(dist)) {
  const relative = path.relative(dist, file).replaceAll('\\', '/');
  if (!/\.(js|json|wxml|wxss|png)$/.test(relative))
    throw new Error('构建目录包含意外文件：' + relative);
  if (/(^|\/)(\.env|data|node_modules|\.git)(\/|$)/.test(relative))
    throw new Error('构建目录包含不允许打包的路径');
  zip['miniprogram/' + relative] = new Uint8Array(await readFile(file));
}
zip['使用说明.md'] = new Uint8Array(
  await readFile(path.join(root, 'docs/wechat-testing.md')),
);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, zipSync(zip, { level: 6 }));
console.log(
  '微信体验版导入包：' +
    output +
    '\n该包不含访问令牌、模型密钥、AppSecret 和个人数据库。',
);
