import { expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { LocalClient } from '../src/local/client';
import { platformStore } from './local-fixtures';

export function imagePhone() {
  const storage = platformStore();
  const files = new Map<string, ArrayBuffer>();
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])
    .buffer;
  files.set('/temp/meal.png', png);
  const fs = {
    mkdirSync: vi.fn(),
    readFile: vi.fn((o: any) =>
      files.has(o.filePath)
        ? o.success({ data: files.get(o.filePath)!.slice(0) })
        : o.fail({ errMsg: 'missing' }),
    ),
    copyFile: vi.fn((o: any) => {
      files.set(o.destPath, files.get(o.srcPath)!.slice(0));
      o.success({});
    }),
    unlinkSync: vi.fn((path: string) => files.delete(path)),
  };
  const platform = {
    ...storage,
    env: { USER_DATA_PATH: '/phone' },
    getFileSystemManager: () => fs,
    arrayBufferToBase64: (value: ArrayBuffer) =>
      Buffer.from(value).toString('base64'),
    request: vi.fn(),
  };
  return { platform, fs, files, png };
}
const clock = () => new Date('2026-10-11T15:59:00Z');

it('accepts native cross-context ArrayBuffers returned by WeChat file IO', async () => {
  const { platform, files } = imagePhone();
  const c = new LocalClient(platform, clock);
  const native = runInNewContext(
    'new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]).buffer',
  );
  expect(native instanceof ArrayBuffer).toBe(false);
  files.set('/temp/meal.png', native);
  const asset = await c.upload('/media/images', '/temp/meal.png', 'native');
  expect(asset.mime_type).toBe('image/png');
});

it('stages image once without networking and keeps bytes and paths out of the backup', async () => {
  const { platform, fs } = imagePhone();
  const c = new LocalClient(platform, clock);
  const asset = await c.upload('/media/images', '/temp/meal.png', 'photo-1');
  expect(asset).toMatchObject({
    kind: 'image',
    mime_type: 'image/png',
    local_date: '2026-10-11',
  });
  expect(await c.upload('/media/images', '/temp/meal.png', 'photo-1')).toEqual(
    asset,
  );
  expect(fs.copyFile).toHaveBeenCalledTimes(1);
  expect(platform.request).not.toHaveBeenCalled();
  const preview = await c.request('GET', '/media/' + asset.id);
  expect(preview.preview_path).toMatch(/^\/phone\/fitmind-media\//);
  const backup = c.exportBackup();
  expect(backup).not.toContain('base64');
  expect(backup).not.toContain('/phone');
  expect(backup).not.toContain('/temp');
  const restarted = new LocalClient(platform, clock);
  expect(await restarted.request('GET', '/media/' + asset.id)).toEqual(preview);
  expect((await c.request('GET', '/records')).items).toHaveLength(0);
});

it('rejects unsupported bytes, oversized images and an upload key used for another file', async () => {
  const { platform, files } = imagePhone();
  const c = new LocalClient(platform, clock);
  files.set('/temp/not.jpg', new Uint8Array([1, 2, 3, 4]).buffer);
  await expect(
    c.upload('/media/images', '/temp/not.jpg', 'bad'),
  ).rejects.toThrow('格式');
  files.set('/temp/big.png', new Uint8Array(5 * 1024 * 1024 + 1).buffer);
  await expect(
    c.upload('/media/images', '/temp/big.png', 'big'),
  ).rejects.toThrow('5 MB');
  await c.upload('/media/images', '/temp/meal.png', 'unique');
  await expect(
    c.upload('/media/images', '/temp/not.jpg', 'unique'),
  ).rejects.toThrow('重复');
});

it('enables only DeepSeek Flash vision and keeps keyboard dictation provider free', async () => {
  const { platform } = imagePhone();
  const c = new LocalClient(platform, clock);
  expect(c.capabilities).toMatchObject({
    vision: false,
    transcription: false,
    voice_input: 'keyboard',
  });
  c.agent.saveModel({
    api_key: 'synthetic-photo-key',
    model: 'deepseek-flash',
  });
  expect(c.capabilities.vision).toBe(true);
  c.agent.saveModel({
    api_key: 'synthetic-photo-key',
    model: 'deepseek-v4-pro',
  });
  expect(c.capabilities.vision).toBe(false);
});

it('drops cache on data replacement and cannot read a file path supplied by an imported media row', async () => {
  const { platform, fs } = imagePhone();
  const c = new LocalClient(platform, clock);
  const asset = await c.upload('/media/images', '/temp/meal.png', 'replace');
  const backup = JSON.parse(c.exportBackup());
  backup.entities.find((e: any) => e.kind === 'media').value.path =
    '/phone/private-key.txt';
  await c.importBackup(JSON.stringify(backup));
  expect(c.exportBackup()).not.toContain('private-key');
  await expect(c.request('GET', '/media/' + asset.id)).rejects.toThrow('照片');
  expect(fs.unlinkSync).toHaveBeenCalled();
  expect(
    fs.readFile.mock.calls.every(
      ([o]: any[]) => !o.filePath.includes('private-key'),
    ),
  ).toBe(true);
});

it('imports legacy desktop image and audio metadata without using desktop file paths', async () => {
  const { platform, fs } = imagePhone();
  const c = new LocalClient(platform, clock);
  const backup = JSON.parse(c.exportBackup());
  const base = { version: 1, created_at: '2026-10-11T15:59:00Z' };
  backup.entities = [
    {
      user_id: 'personal',
      kind: 'media',
      value: {
        ...base,
        id: 'legacy-image',
        kind: 'image',
        mime_type: 'image/png',
        size_bytes: 8 * 1024 * 1024,
        path: 'C:/private/image.png',
        extension: 'png',
      },
    },
    {
      user_id: 'personal',
      kind: 'media',
      value: {
        ...base,
        id: 'legacy-audio',
        kind: 'audio',
        mime_type: 'audio/mpeg',
        size_bytes: 20000,
        path: 'C:/private/audio.mp3',
        extension: 'mp3',
      },
    },
  ];
  expect(() => c.inspectBackup(JSON.stringify(backup))).not.toThrow();
  await c.importBackup(JSON.stringify(backup));
  expect(c.core.store.list('personal', 'media')).toHaveLength(2);
  expect(c.exportBackup()).not.toContain('C:/private');
  await expect(c.request('GET', '/media/legacy-image')).rejects.toThrow(
    '照片缓存',
  );
  expect(fs.readFile).not.toHaveBeenCalled();
});

it('keeps midnight capture date and blocks import while a file is being staged', async () => {
  const { platform, fs, png } = imagePhone();
  let now = new Date('2026-10-11T15:59:00Z');
  const c = new LocalClient(platform, () => now);
  const blank = c.exportBackup();
  let read: any;
  fs.readFile.mockImplementationOnce((o: any) => {
    read = o;
  });
  const uploading = c.upload('/media/images', '/temp/meal.png', 'midnight');
  now = new Date('2026-10-11T16:01:00Z');
  await expect(c.importBackup(blank)).rejects.toThrow('有操作正在处理');
  read.success({ data: png });
  const asset = await uploading;
  expect(asset.local_date).toBe('2026-10-11');
  expect(c.core.context().local_date).toBe('2026-10-12');
});

it('cleans an uncommitted file after quota failure and can retry the selection', async () => {
  const { platform, files } = imagePhone();
  const c = new LocalClient(platform, clock);
  platform.failWrites(true);
  await expect(
    c.upload('/media/images', '/temp/meal.png', 'quota'),
  ).rejects.toThrow('尚未保存');
  expect(
    [...files.keys()].filter((p) => p.includes('fitmind-media')),
  ).toHaveLength(0);
  platform.failWrites(false);
  const asset = await c.upload('/media/images', '/temp/meal.png', 'quota');
  expect(await c.request('GET', '/media/' + asset.id)).toHaveProperty(
    'preview_path',
  );
  expect(c.core.store.list('personal', 'media')).toHaveLength(1);
});

it('bounds retained photos while preserving confirmed food records', async () => {
  const { platform, files } = imagePhone();
  const c = new LocalClient(platform, clock);
  const first = await c.upload('/media/images', '/temp/meal.png', 'first');
  await c.mutate('/records', {
    kind: 'food',
    name: '米饭',
    source: 'estimate',
    nutrition: { calories_kcal: 200, carbs_g: 40, protein_g: 4, fat_g: 1 },
    attachment_ids: [first.id],
  });
  for (let i = 0; i < 30; i++)
    await c.upload('/media/images', '/temp/meal.png', 'next-' + i);
  expect(
    [...files.keys()].filter((p) => p.includes('fitmind-media')),
  ).toHaveLength(30);
  await expect(c.request('GET', '/media/' + first.id)).rejects.toThrow(
    '照片缓存',
  );
  expect((await c.request('GET', '/records')).items).toHaveLength(1);
  expect(() => c.inspectBackup(c.exportBackup())).not.toThrow();
});
