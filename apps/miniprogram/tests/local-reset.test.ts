import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalClient } from '../src/local/client';
import { platformStore } from './local-fixtures';
import { setupDraftPrompt } from '../src/lib/onboarding';

afterEach(() => vi.unstubAllGlobals());
const clock = () => new Date('2026-10-11T10:00:00Z');
async function seeded() {
  const platform = platformStore();
  const c = new LocalClient(platform, clock);
  await c.refresh();
  await c.mutate(
    '/profile',
    {
      expected_version: 0,
      name: '测试用户',
      timezone: 'Asia/Shanghai',
      reminder_time: '20:30',
      fitness: {
        height_cm: 177,
        weight_kg: 72,
        sex: 'male',
        goal: '薄肌',
        strength_training: 'yes',
      },
      onboarding_status: 'completed',
    },
    'PATCH',
  );
  await c.sendChat('喝了300毫升水');
  await c.mutate('/targets/drafts', {
    effective_from: '2026-10-11',
    water_ml: 2500,
    calories_kcal: 2000,
    carbs_g: 220,
    protein_g: 120,
    fat_g: 65,
  });
  c.agent.saveModel({ api_key: 'reset-fixture-key', model: 'deepseek-flash' });
  await c.refresh();
  c.save('draft', '未发出的输入');
  c.save('setup.input', {
    answer: '旧答案',
    step: 'goal',
    suggestionId: '旧建议',
  });
  c.save('pending', [
    {
      id: 'stale',
      path: '/records',
      method: 'POST',
      body: { kind: 'water', amount_ml: 999 },
    },
  ]);
  platform.values.set('fitmind.local.v1.obsolete.setup.input', {
    answer: '更早的缓存',
  });
  platform.values.set('unrelated.preference', 'keep');
  return { c, platform };
}

describe('local data reset', () => {
  it('clears records, history, goals, profile and all old input scopes, keeps AI, and restarts empty', async () => {
    const { c, platform } = await seeded();
    const scope = c.storageKey;
    await c.clearLocalData();
    expect(c.storageKey).not.toBe(scope);
    expect(JSON.parse(c.exportBackup()).entities).toEqual([]);
    expect(JSON.parse(c.exportBackup()).operations).toEqual([]);
    expect(c.data.profile.fitness).toBeUndefined();
    expect(c.data.summary.water_ml.known_total).toBe(0);
    expect(c.pending()).toEqual([]);
    expect(c.saved('draft', '')).toBe('');
    expect(
      [...platform.values.keys()].filter(
        (k) =>
          k.startsWith(scope + '.') ||
          k.startsWith('fitmind.local.v1.obsolete.'),
      ),
    ).toEqual([]);
    expect(c.agent.modelSettings.api_key).toBe('reset-fixture-key');
    expect(platform.values.get('unrelated.preference')).toBe('keep');
    const restarted = new LocalClient(platform, clock);
    await restarted.refresh();
    expect(restarted.data.records).toEqual([]);
    expect(restarted.data.messages).toEqual([]);
    expect(restarted.data.targets).toEqual([]);
    expect(restarted.agent.modelSettings.api_key).toBe('reset-fixture-key');
  });
  it('restarts only coach setup while preserving records, history, goals and reminder settings', async () => {
    const { c } = await seeded();
    const records = c.data.records,
      targets = c.data.targets,
      messages = c.data.messages;
    await c.restartOnboarding();
    expect(c.data.profile.fitness).toBeUndefined();
    expect(c.data.profile.onboarding_status).toBe('in_progress');
    expect(c.data.profile.reminder_time).toBe('20:30');
    expect(c.data.profile.name).toBe('测试用户');
    expect(c.data.records).toEqual(records);
    expect(c.data.targets).toEqual(targets);
    expect(c.data.messages).toEqual(messages);
    expect(c.pending()).toEqual([]);
    expect(c.saved('setup.input', null)).toBeNull();
    expect(c.agent.modelSettings.api_key).toBe('reset-fixture-key');
  });
  it('keeps previous data and cached answers when clearing cannot be persisted', async () => {
    const { c, platform } = await seeded();
    const before = c.exportBackup(),
      scope = c.storageKey;
    platform.failWrites(true);
    await expect(c.clearLocalData()).rejects.toThrow('保存失败');
    expect(c.exportBackup()).toBe(before);
    expect(c.storageKey).toBe(scope);
    expect(c.saved('setup.input', null).answer).toBe('旧答案');
    expect(c.agent.modelSettings.api_key).toBe('reset-fixture-key');
  });
  it('refuses either reset while the local client is refreshing', async () => {
    const { c } = await seeded();
    const before = c.exportBackup();
    const refresh = c.refresh();
    const clearing = c.clearLocalData(),
      restarting = c.restartOnboarding();
    await expect(clearing).rejects.toThrow('有操作正在处理');
    await expect(restarting).rejects.toThrow('有操作正在处理');
    await refresh;
    expect(c.exportBackup()).toBe(before);
  });
  it('does not clear data underneath an in-flight model reply', async () => {
    const { c, platform } = await seeded();
    let request: any;
    Object.assign(platform, {
      request: (options: any) => {
        request = options;
        return { abort() {} };
      },
    });
    const reply = c.sendChat('你好');
    await vi.waitFor(() => expect(request).toBeDefined());
    await expect(c.clearLocalData()).rejects.toThrow('有操作正在处理');
    await expect(c.restartOnboarding()).rejects.toThrow('有操作正在处理');
    request.success({
      statusCode: 200,
      data: {
        choices: [
          {
            finish_reason: 'stop',
            message: { role: 'assistant', content: '你好。' },
          },
        ],
      },
    });
    await reply;
    await c.refresh();
    expect(c.data.summary.water_ml.known_total).toBe(300);
    expect(c.data.messages).toHaveLength(2);
    expect(c.data.profile.onboarding_status).toBe('completed');
  });
  it('protects a chat submission between capturing time and starting the message request', async () => {
    const { c } = await seeded();
    c.agent.clearModel();
    c.save('pending', []);
    const sending = c.sendChat('喝了300毫升水');
    await Promise.resolve();
    await expect(c.clearLocalData()).rejects.toThrow('有操作正在处理');
    await sending;
    await c.clearLocalData();
    expect(c.data.summary.water_ml.known_total).toBe(0);
    expect(c.data.records).toEqual([]);
  });
});

async function settingsPage(c: LocalClient, confirm: boolean | 'pending') {
  vi.resetModules();
  let definition: any, modal: any;
  vi.stubGlobal('getApp', () => ({ client: c }));
  vi.stubGlobal('Page', (p: any) => {
    definition = p;
  });
  vi.stubGlobal('wx', {
    showToast: vi.fn(),
    navigateTo: vi.fn(),
    switchTab: vi.fn(),
    showModal: (options: any) => {
      modal = options;
      if (confirm !== 'pending') options.success({ confirm, cancel: !confirm });
    },
  });
  await import('../src/pages/settings/index');
  const p: any = {
    ...definition,
    data: structuredClone(definition.data),
    setData(value: any) {
      Object.assign(this.data, value);
    },
  };
  await p.load();
  return { p, modal: () => modal };
}

describe('settings reset controls', () => {
  it('cancel leaves existing data and AI configuration intact', async () => {
    const { c } = await seeded();
    const { p } = await settingsPage(c, false);
    const before = c.exportBackup();
    await p.clearData();
    expect(c.exportBackup()).toBe(before);
    expect(c.agent.modelSettings.api_key).toBe('reset-fixture-key');
    expect(p.data.busy).toBe(false);
    expect(wx.switchTab).not.toHaveBeenCalled();
  });
  it('confirmed clear refreshes settings and returns home ready for first setup', async () => {
    const { c } = await seeded();
    const { p } = await settingsPage(c, true);
    await p.clearData();
    expect(c.data.records).toEqual([]);
    expect(p.data.profile.fitness).toBeUndefined();
    expect(p.data.keySaved).toBe(true);
    expect(p.data.busy).toBe(false);
    expect(p.data.error).toBe('');
    expect(wx.switchTab).toHaveBeenCalledWith({ url: '/pages/today/index' });
  });
  it('confirmed setup restart navigates to guide and keeps existing records', async () => {
    const { c } = await seeded();
    const { p } = await settingsPage(c, true);
    await p.restartSetup();
    expect(c.data.summary.water_ml.known_total).toBe(300);
    expect(c.data.profile.fitness).toBeUndefined();
    expect(p.data.busy).toBe(false);
    expect(wx.navigateTo).toHaveBeenCalledWith({
      url: '/pages/onboarding/index',
    });
  });
  it('an old confirmation cannot erase a backup imported while the dialog was open', async () => {
    const { c } = await seeded();
    const { p, modal } = await settingsPage(c, 'pending');
    const clear = p.clearData();
    await c.importBackup(c.exportBackup());
    modal().success({ confirm: true });
    await clear;
    expect(c.data.records).toHaveLength(1);
    expect(p.data.error).toContain('重新确认');
    expect(p.data.busy).toBe(false);
    expect(wx.switchTab).not.toHaveBeenCalled();
  });
  it('shows storage errors without returning home or losing records', async () => {
    const { c, platform } = await seeded();
    const { p } = await settingsPage(c, true);
    platform.failWrites(true);
    await p.clearData();
    expect(c.data.summary.water_ml.known_total).toBe(300);
    expect(p.data.error).toContain('保存失败');
    expect(p.data.busy).toBe(false);
    expect(wx.switchTab).not.toHaveBeenCalled();
  });
  it('reopened setup asks new questions without showing a previous setup suggestion', async () => {
    const { c, platform } = await seeded();
    c.save('pending', []);
    Object.assign(platform, {
      request: (options: any) => {
        options.success({
          statusCode: 200,
          data: {
            choices: [
              {
                finish_reason: 'stop',
                message: { role: 'assistant', content: '旧目标建议' },
              },
            ],
          },
        });
        return { abort() {} };
      },
    });
    await c.sendChat(setupDraftPrompt());
    const setStorage = platform.setStorageSync;
    platform.setStorageSync = (key: string, value: any) => {
      if (key.endsWith('.setup.input')) throw new Error('UI cache unavailable');
      setStorage(key, value);
    };
    await c.restartOnboarding();
    platform.setStorageSync = setStorage;
    await c.importBackup(c.exportBackup());
    vi.resetModules();
    let definition: any;
    vi.stubGlobal('getApp', () => ({ client: c }));
    vi.stubGlobal('Page', (p: any) => {
      definition = p;
    });
    vi.stubGlobal('wx', { showToast: vi.fn() });
    await import('../src/pages/onboarding/index');
    const p: any = {
      ...definition,
      data: structuredClone(definition.data),
      setData(value: any) {
        Object.assign(this.data, value);
      },
    };
    await p.load();
    expect(p.data.question.id).toBe('body');
    expect(p.data.suggestion).toBeNull();
    p.input({ detail: { value: '180cm，75kg' } });
    await p.submit();
    expect(p.data.question.id).toBe('sex');
    expect(p.data.suggestion).toBeNull();
    expect(c.data.messages).toHaveLength(2);
  });
});
