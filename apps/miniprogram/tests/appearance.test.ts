import { afterEach, expect, it, vi } from 'vitest';
import { Appearance, themedComponent, themedPage } from '../src/lib/appearance';
import { LocalClient } from '../src/local/client';
import { platformStore } from './local-fixtures';

afterEach(() => vi.unstubAllGlobals());
const screen = (definition: any) => ({
  ...definition,
  data: structuredClone(definition.data),
  setData(values: any) {
    Object.assign(this.data, values);
  },
});

it('defaults to the accepted black-green skin and restores a selected whale skin after restart', () => {
  const platform = platformStore();
  const appearance = new Appearance(platform);
  expect(appearance.data.skin).toBe('midnight');
  appearance.select('deepseek');
  const restored = new Appearance(platform);
  expect(restored.data.skin).toBe('deepseek');
  expect(restored.data.skinStyle).toContain('--fm-accent:#526FD6');
  expect(restored.data.skinTextIcon).toBe('ink');
});
it('falls back for obsolete preferences and rejects unknown skins without changing the saved choice', () => {
  const platform = platformStore();
  platform.setStorageSync('fitmind.appearance.v1', 'obsolete');
  const appearance = new Appearance(platform);
  expect(appearance.data.skin).toBe('midnight');
  expect(() => appearance.select('unknown')).toThrow('皮肤');
  expect(appearance.data.skin).toBe('midnight');
});
it('does not switch the UI or notify subscribers when preference persistence fails', () => {
  const platform = platformStore();
  const appearance = new Appearance(platform),
    listener = vi.fn();
  appearance.subscribe(listener);
  platform.setStorageSync = () => {
    throw new Error('full');
  };
  expect(() => appearance.select('deepseek')).toThrow('保存');
  expect(appearance.data.skin).toBe('midnight');
  expect(listener).not.toHaveBeenCalled();
});
it('keeps appearance across local record clearing and backup replacement without exporting it as fitness data', async () => {
  const platform = platformStore();
  const appearance = new Appearance(platform);
  appearance.select('deepseek');
  const c = new LocalClient(platform, () => new Date('2026-10-11T10:00:00Z'));
  await c.refresh();
  await c.mutate('/records', { kind: 'water', amount_ml: 300 });
  const backup = c.exportBackup();
  expect(backup).not.toContain('fitmind.appearance');
  await c.clearLocalData();
  await c.importBackup(backup);
  expect(new Appearance(platform).data.skin).toBe('deepseek');
  expect(c.data.summary.water_ml.known_total).toBe(300);
});
it('updates mounted pages and isolated components together, preserves lifecycle work and detaches listeners', () => {
  const appearance = new Appearance(platformStore());
  vi.stubGlobal('getApp', () => ({ appearance }));
  vi.stubGlobal('wx', {
    setNavigationBarColor: vi.fn(),
    setBackgroundColor: vi.fn(),
  });
  const loaded = vi.fn(),
    unloaded = vi.fn(),
    attached = vi.fn(),
    detached = vi.fn();
  const p = screen(
    themedPage({
      data: { busy: false, draft: '未发送' },
      onLoad: loaded,
      onUnload: unloaded,
    }),
  );
  const component = themedComponent({
    data: { recording: true },
    lifetimes: { attached, detached },
  });
  const dock = screen(component);
  p.onLoad({ id: 'goal' });
  component.lifetimes.attached.call(dock);
  appearance.select('deepseek');
  expect(p.data.skin).toBe('deepseek');
  expect(dock.data.skin).toBe('deepseek');
  expect(p.data.draft).toBe('未发送');
  expect(dock.data.recording).toBe(true);
  expect(loaded).toHaveBeenCalledWith({ id: 'goal' });
  expect(attached).toHaveBeenCalledOnce();
  p.onUnload();
  component.lifetimes.detached.call(dock);
  appearance.select('midnight');
  expect(p.data.skin).toBe('deepseek');
  expect(dock.data.skin).toBe('deepseek');
  expect(unloaded).toHaveBeenCalledOnce();
  expect(detached).toHaveBeenCalledOnce();
});
it('applies matching navigation colors when a page becomes visible and keeps them correct on return', () => {
  const appearance = new Appearance(platformStore());
  vi.stubGlobal('getApp', () => ({ appearance }));
  vi.stubGlobal('wx', {
    setNavigationBarColor: vi.fn(),
    setBackgroundColor: vi.fn(),
  });
  const p = screen(
    themedPage({
      data: {},
      onShow() {
        this._visible = true;
      },
    }),
  );
  p.onLoad();
  p.onShow();
  appearance.select('deepseek');
  p.onShow();
  expect(wx.setNavigationBarColor).toHaveBeenLastCalledWith(
    expect.objectContaining({
      frontColor: '#000000',
      backgroundColor: '#F3F6FF',
    }),
  );
  appearance.select('midnight');
  expect(wx.setNavigationBarColor).toHaveBeenLastCalledWith(
    expect.objectContaining({
      frontColor: '#ffffff',
      backgroundColor: '#000000',
    }),
  );
  p.onUnload();
});
