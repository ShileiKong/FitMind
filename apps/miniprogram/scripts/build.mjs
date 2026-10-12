import { build } from 'esbuild';
import {
  readdir,
  readFile,
  writeFile,
  mkdir,
  cp,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIcons } from './icons.mjs';
import sharp from 'sharp';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const output = path.resolve(arg('out') || path.join(root, 'dist'));
const project = JSON.parse(
  await readFile(path.join(root, 'project.settings.json'), 'utf8'),
);
const appid =
  arg('appid') || process.env.WECHAT_APP_ID || project.appid || 'touristappid';
if (appid !== 'touristappid' && !/^wx[a-f0-9]{16}$/.test(appid))
  throw new Error('AppID 格式不正确，应为 wx 开头的 18 位 AppID');
const apiUrl =
  arg('api-url') || process.env.FITMIND_API_URL || project.api_url || '';
if (apiUrl && !/^https?:\/\/[a-zA-Z0-9.-]+(?::\d+)?$/.test(apiUrl))
  throw new Error('服务地址需为 http/https 的 origin，不含路径');
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) =>
        e.isDirectory()
          ? files(path.join(dir, e.name))
          : [path.join(dir, e.name)],
      ),
    )
  ).flat();
}
await mkdir(output, { recursive: true });
const source = path.join(root, 'src');
for (const file of await files(source)) {
  if (!/\.(wxml|wxss|json|png)$/.test(file)) continue;
  const to = path.join(output, path.relative(source, file));
  await mkdir(path.dirname(to), { recursive: true });
  if (file.includes(path.join('assets', 'skins')) && file.endsWith('.png'))
    await sharp(file)
      .resize({ width: 512, withoutEnlargement: true })
      .png({ palette: true, quality: 90, compressionLevel: 9 })
      .toFile(to);
  else await cp(file, to);
}
const app = JSON.parse(await readFile(path.join(source, 'app.json'), 'utf8'));
const entries = [
  'app.ts',
  ...(app.tabBar.custom ? ['custom-tab-bar/index.ts'] : []),
  ...app.pages.map((p) => p + '.ts'),
  ...Object.values(app.usingComponents).map((p) => p.slice(1) + '.ts'),
].map((p) => path.join(source, p));
await buildIcons(output);
await build({
  entryPoints: entries,
  bundle: true,
  platform: 'neutral',
  format: 'cjs',
  target: ['es2020'],
  outbase: source,
  outdir: output,
  define: { __FITMIND_API_URL__: JSON.stringify(apiUrl) },
  inject: [path.join(source, 'local/runtime.ts')],
  logLevel: 'warning',
});
for (const page of app.pages) {
  const json = path.join(output, page + '.json');
  try {
    await stat(json);
  } catch {
    await writeFile(json, '{}\n');
  }
}
await writeFile(
  path.join(output, 'project.config.json'),
  JSON.stringify(
    {
      appid,
      projectname: 'FitMind',
      miniprogramRoot: './',
      compileType: 'miniprogram',
      libVersion: 'latest',
      setting: {
        es6: true,
        enhance: true,
        minified: true,
        urlCheck: true,
        postcss: true,
      },
    },
    null,
    2,
  ) + '\n',
);
for (const p of app.pages)
  for (const extension of ['.js', '.wxml', '.json'])
    await stat(path.join(output, p + extension));
console.log(
  `FitMind 小程序已构建：${output}\nAppID：${appid}\n${appid === 'touristappid' ? '尚未配置 AppID，可先导入工具查看；手机预览/体验版需注册账号或测试号。' : '导入此目录到微信开发者工具即可预览。'}`,
);
