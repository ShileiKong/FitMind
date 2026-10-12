import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalClient } from '../src/local/client';
import { platformStore } from './local-fixtures';

afterEach(() => vi.unstubAllGlobals());

async function settingsPage(model?: string) {
  vi.resetModules();
  const platform = {
    ...platformStore(),
    request: vi.fn(() => {
      throw new Error('Settings display must not make a network request.');
    }),
  };
  const c = new LocalClient(platform, () => new Date('2026-10-11T10:00:00Z'));
  if (model)
    c.agent.saveModel({ api_key: 'synthetic-settings-fixture-key', model });
  let definition: any;
  vi.stubGlobal('getApp', () => ({ client: c }));
  vi.stubGlobal('Page', (value: any) => {
    definition = value;
  });
  vi.stubGlobal('wx', { showToast: vi.fn() });
  await import('../src/pages/settings/index');
  const updates: any[] = [];
  const p: any = {
    ...definition,
    data: structuredClone(definition.data),
    setData(value: any) {
      updates.push(structuredClone(value));
      Object.assign(this.data, value);
    },
  };
  await p.load();
  return { c, p, updates, platform };
}

describe('phone-local settings capability display', () => {
  it.each([
    {
      name: 'no saved Key',
      model: undefined,
      keySaved: false,
      textStatus: '本地记录助手',
      visionStatus: '需 DeepSeek Flash 和 Key',
    },
    {
      name: 'saved Key with deepseek-flash',
      model: 'deepseek-flash',
      keySaved: true,
      textStatus: '已配置',
      visionStatus: '已配置',
    },
    {
      name: 'saved Key with deepseek-v4-flash',
      model: 'deepseek-v4-flash',
      keySaved: true,
      textStatus: '已配置',
      visionStatus: '已配置',
    },
    {
      name: 'saved Key with deepseek-v4-flash-vision-exp',
      model: 'deepseek-v4-flash-vision-exp',
      keySaved: true,
      textStatus: '已配置',
      visionStatus: '已配置',
    },
    {
      name: 'saved Key with a non-Flash model',
      model: 'deepseek-reasoner',
      keySaved: true,
      textStatus: '已配置',
      visionStatus: '需 DeepSeek Flash 和 Key',
    },
  ])(
    'shows capability guidance for $name without validating a Key online',
    async (row) => {
      const { c, p, updates, platform } = await settingsPage(row.model);
      expect(p.data.error).toBe('');
      expect(p.data.keySaved).toBe(row.keySaved);
      expect(p.data.textStatus).toBe(row.textStatus);
      expect(p.data.visionStatus).toBe(row.visionStatus);
      expect(p.data.transcriptionStatus).toBe('手机键盘听写');
      expect(p.data.api_key).toBe('');
      expect(JSON.stringify(updates)).not.toContain(
        'synthetic-settings-fixture-key',
      );
      expect(c.agent.modelSettings.api_key).toBe(
        row.keySaved ? 'synthetic-settings-fixture-key' : '',
      );
      expect(platform.request).not.toHaveBeenCalled();
    },
  );

  it('preserves a typed replacement Key while refreshing the saved capability display', async () => {
    const { c, p, platform } = await settingsPage('deepseek-flash');
    p.input({
      currentTarget: { dataset: { field: 'api_key' } },
      detail: { value: 'unsaved-settings-fixture-key' },
    });
    await p.render(c);
    expect(p.data.api_key).toBe('unsaved-settings-fixture-key');
    expect(c.agent.modelSettings.api_key).toBe(
      'synthetic-settings-fixture-key',
    );
    expect(platform.request).not.toHaveBeenCalled();
  });
});
