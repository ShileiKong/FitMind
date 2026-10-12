import { afterEach, expect, it, vi } from 'vitest';
import { LocalClient } from '../src/local/client';

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeView(data: any = {}) {
  const composer = { focusInput: vi.fn() };
  const view: any = {
    data: {
      busy: false,
      recording: false,
      draft: '原有草稿',
      attachments: [],
      capabilities: { transcription: false },
      ...data,
    },
    selectComponent: vi.fn((selector: string) =>
      selector === '#composer' ? composer : null,
    ),
    setData(value: any) {
      Object.assign(this.data, value);
    },
  };
  return { view, composer };
}

it.each([
  { isLocal: true, capabilities: { transcription: false } },
  { isLocal: true, capabilities: { transcription: true } },
  { isLocal: false, capabilities: { voice_input: 'keyboard' } },
])('guides keyboard dictation without recording or uploading (%j)', async (mode) => {
  vi.resetModules();
  const c = {
    isLocal: mode.isLocal,
    storageKey: 'test-phone',
    upload: vi.fn(),
    mutate: vi.fn(),
  };
  const app = { client: c };
  const platform = {
    authorize: vi.fn(),
    getSetting: vi.fn(),
    getRecorderManager: vi.fn(),
    uploadFile: vi.fn(),
    showToast: vi.fn(),
  };
  vi.stubGlobal('getApp', () => app);
  vi.stubGlobal('wx', platform);
  const { voice } = await import('../src/lib/recording');
  const { view, composer } = makeView({ capabilities: mode.capabilities });

  voice(view);

  expect(view.selectComponent).toHaveBeenCalledWith('#composer');
  expect(composer.focusInput).toHaveBeenCalledOnce();
  expect(platform.showToast).toHaveBeenCalledWith(
    expect.objectContaining({
      title: expect.stringMatching(/键盘.*麦克风.*听写.*发送/),
      icon: 'none',
    }),
  );
  expect(view.data.draft).toBe('原有草稿');
  expect(view.data.recording).toBe(false);
  expect(platform.authorize).not.toHaveBeenCalled();
  expect(platform.getSetting).not.toHaveBeenCalled();
  expect(platform.getRecorderManager).not.toHaveBeenCalled();
  expect(platform.uploadFile).not.toHaveBeenCalled();
  expect(c.upload).not.toHaveBeenCalled();
  expect(c.mutate).not.toHaveBeenCalled();
});

it('leaves the keyboard and draft alone while a message is busy', async () => {
  vi.resetModules();
  vi.stubGlobal('getApp', () => ({ client: { isLocal: true } }));
  const showToast = vi.fn();
  vi.stubGlobal('wx', { showToast });
  const { voice } = await import('../src/lib/recording');
  const { view, composer } = makeView({ busy: true });

  voice(view);

  expect(composer.focusInput).not.toHaveBeenCalled();
  expect(showToast).not.toHaveBeenCalled();
  expect(view.data.draft).toBe('原有草稿');
});

it('keeps dictated text editable and only creates a record after explicit send', async () => {
  vi.resetModules();
  const storage = new Map<string, any>();
  const platform = {
    getStorageSync: (key: string) => structuredClone(storage.get(key)),
    setStorageSync: (key: string, value: any) =>
      storage.set(key, structuredClone(value)),
    removeStorageSync: (key: string) => storage.delete(key),
    request: vi.fn(() => {
      throw new Error('Unexpected network');
    }),
    showToast: vi.fn(),
    getRecorderManager: vi.fn(),
  };
  const c = new LocalClient(platform, () => new Date('2026-10-11T10:00:00Z'));
  await c.refresh();
  const sendChat = vi.spyOn(c, 'sendChat');
  const upload = vi.spyOn(c, 'upload');
  vi.stubGlobal('getApp', () => ({ client: c }));
  vi.stubGlobal('wx', platform);
  const { chatActions } = await import('../src/lib/chat-actions');
  const { view, composer } = makeView();
  Object.assign(view, chatActions, { load: () => c.refresh() });

  view.voice();
  view.input({ detail: { value: '喝了200毫升水' } });
  view.input({ detail: { value: '喝了300毫升水' } });
  await c.refresh();

  expect(composer.focusInput).toHaveBeenCalledOnce();
  expect(c.saved('draft', '')).toBe('喝了300毫升水');
  expect(c.data.messages).toHaveLength(0);
  expect(c.data.summary.water_ml.known_total).toBe(0);
  expect(sendChat).not.toHaveBeenCalled();
  expect(upload).not.toHaveBeenCalled();
  expect(platform.getRecorderManager).not.toHaveBeenCalled();

  await view.send();

  expect(sendChat).toHaveBeenCalledOnce();
  expect(c.data.messages).toHaveLength(1);
  expect(c.data.summary.water_ml.known_total).toBe(300);
  expect(view.data.draft).toBe('');
  expect(platform.request).not.toHaveBeenCalled();
});

it('can reopen the composer keyboard after it was dismissed', async () => {
  vi.resetModules();
  let definition: any;
  const ticks: (() => void)[] = [];
  vi.stubGlobal('Component', (value: any) => {
    definition = value;
  });
  vi.stubGlobal('wx', { nextTick: (fn: () => void) => ticks.push(fn) });
  await import('../src/components/composer/index');
  const view: any = {
    data: { focus: true, value: '继续编辑', ...definition.data },
    triggerEvent: vi.fn(),
    setData(value: any) {
      Object.assign(this.data, value);
    },
  };

  for (let tap = 0; tap < 2; tap++) {
    definition.methods.focusInput.call(view);
    expect(view.data.focus).toBe(false);
    ticks.shift()?.();
    expect(view.data.focus).toBe(true);
  }

  expect(view.data.value).toBe('继续编辑');
  expect(view.triggerEvent).not.toHaveBeenCalled();
});
