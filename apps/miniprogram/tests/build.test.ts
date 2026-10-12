import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

it('forwards public AppID while local settings do not ask for a computer service', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const output = mkdtempSync(path.join(tmpdir(), 'fitmind-mini-cli-'));
  if (!process.env.npm_execpath)
    throw new Error('Run this CLI integration test using npm test');
  execFileSync(
    process.execPath,
    [
      process.env.npm_execpath,
      'run',
      'export:miniprogram',
      '--',
      '--appid',
      'wx0123456789abcdef',
      '--api-url',
      'http://192.168.1.123:9999',
      '--out',
      output,
    ],
    { cwd: path.resolve(root, '../..') },
  );
  const config = JSON.parse(
    readFileSync(path.join(output, 'project.config.json'), 'utf8'),
  );
  let page: any;
  runInNewContext(
    readFileSync(path.join(output, 'pages/settings/index.js'), 'utf8'),
    {
      Page: (definition: any) => {
        page = definition;
      },
    },
    { timeout: 1000 },
  );
  expect(config.appid).toBe('wx0123456789abcdef');
  expect(page.data.base_url).toBeUndefined();
  expect(page.data.model).toBe('deepseek-flash');
  expect(page.data.api_key).toBe('');
});

it('builds an importable project with the configured AppID and runnable native entries', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const output = mkdtempSync(path.join(tmpdir(), 'fitmind-mini-build-'));
  execFileSync(
    process.execPath,
    [path.join(root, 'scripts/build.mjs'), '--out', output],
    {
      env: { ...process.env, WECHAT_APP_ID: '', FITMIND_API_URL: '' },
    },
  );
  const config = JSON.parse(
    readFileSync(path.join(output, 'project.config.json'), 'utf8'),
  );
  expect(config.appid).toBe('touristappid');
  const manifest = JSON.parse(
    readFileSync(path.join(output, 'app.json'), 'utf8'),
  );
  const registrations: any[] = [];
  const globals = {
    wx: { getStorageSync: () => '' },
    App: (definition: any) => registrations.push(definition),
    Page: (definition: any) => registrations.push(definition),
    Component: (definition: any) => registrations.push(definition),
  };
  const components = Object.values(manifest.usingComponents).map((p: any) =>
    p.slice(1),
  );
  for (const entry of ['app', ...manifest.pages, ...components]) {
    runInNewContext(
      readFileSync(path.join(output, entry + '.js'), 'utf8'),
      globals,
      { timeout: 1000 },
    );
    if (entry !== 'app')
      expect(existsSync(path.join(output, entry + '.wxml'))).toBe(true);
    expect(existsSync(path.join(output, entry + '.json'))).toBe(true);
  }
  expect(registrations).toHaveLength(
    manifest.pages.length + components.length + 1,
  );
  expect(registrations[0].client.connected).toBe(true);
  expect(registrations[0].client.isLocal).toBe(true);
  for (const page of manifest.tabBar.list)
    expect(manifest.pages).toContain(page.pagePath);
});
