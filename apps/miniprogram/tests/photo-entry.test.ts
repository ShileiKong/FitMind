import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocalClient } from '../src/local/client';

let c: LocalClient, app: any;
let sheet: any, picker: any;
let actions: any;
beforeEach(async () => {
  vi.resetModules();
  const storage = new Map<string, any>();
  c = new LocalClient(
    {
      getStorageSync: (key: string) => structuredClone(storage.get(key)),
      setStorageSync: (key: string, value: any) =>
        storage.set(key, structuredClone(value)),
      removeStorageSync: (key: string) => storage.delete(key),
    },
    () => new Date('2026-10-12T10:00:00Z'),
  );
  await c.refresh();
  app = { client: c };
  sheet = picker = null;
  vi.stubGlobal('getApp', () => app);
  vi.stubGlobal('wx', {
    showActionSheet: vi.fn((options) => {
      sheet = options;
    }),
    chooseMedia: vi.fn((options) => {
      picker = options;
    }),
    navigateTo: vi.fn(),
    showToast: vi.fn(),
  });
  actions = (await import('../src/lib/chat-actions')).chatActions;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function view() {
  return {
    ...actions,
    _visible: true,
    data: {
      busy: false,
      recording: false,
      capabilities: { vision: true },
      attachments: [],
    },
    setData(values: any) {
      Object.assign(this.data, values);
    },
  } as any;
}
it('offers meal and label capture and opens a local review without attaching or recording food', async () => {
  const p = view();
  const upload = vi.spyOn(c, 'upload').mockResolvedValue({ id: 'photo-one' });
  const capture = p.photo();
  expect(sheet?.itemList).toEqual([
    '拍餐食 · 估算营养',
    '拍营养表 · 按食用量计算',
  ]);
  sheet.success({ tapIndex: 1 });
  await vi.waitFor(() => expect(picker).not.toBeNull());
  picker.success({
    tempFiles: [{ tempFilePath: 'wxfile://label.jpg', size: 200 }],
  });
  await capture;
  expect(upload).toHaveBeenCalledWith(
    '/media/images',
    'wxfile://label.jpg',
    expect.any(String),
  );
  expect(wx.navigateTo).toHaveBeenCalledWith({
    url: '/pages/photo-review/index?asset=photo-one&mode=label',
  });
  expect(c.saved('attachments', [])).toEqual([]);
  expect((await c.request('GET', '/records')).items).toEqual([]);
});
it('treats picker cancellation as no change and prevents a second concurrent capture', async () => {
  const p = view();
  const capture = p.photo();
  void p.photo();
  expect(wx.showActionSheet).toHaveBeenCalledTimes(1);
  sheet.fail({ errMsg: 'showActionSheet:fail cancel' });
  await capture;
  expect(p.data.error || '').toBe('');
  expect(p.data.busy).toBe(false);
  expect(wx.chooseMedia).not.toHaveBeenCalled();
});
it('drops camera callbacks after the client scope changes', async () => {
  const p = view();
  const upload = vi.spyOn(c, 'upload').mockResolvedValue({ id: 'stale' });
  const capture = p.photo();
  sheet.success({ tapIndex: 0 });
  await vi.waitFor(() => expect(picker).not.toBeNull());
  await c.importBackup(c.exportBackup());
  picker.success({
    tempFiles: [{ tempFilePath: 'wxfile://old.jpg', size: 200 }],
  });
  await capture;
  expect(upload).not.toHaveBeenCalled();
  expect(wx.navigateTo).not.toHaveBeenCalled();
});
it('explains the required local vision model when camera recognition is not configured', async () => {
  const p = view();
  p.data.capabilities.vision = false;
  await p.photo();
  expect(p.data.error).toContain('DeepSeek');
  expect(p.data.error).toContain('flash');
  expect(wx.chooseMedia).not.toHaveBeenCalled();
});

it('rejects a local image above five megabytes before trying to save it', async () => {
  const p = view();
  const upload = vi.spyOn(c, 'upload').mockResolvedValue({ id: 'too-large' });
  const capture = p.photo();
  sheet.success({ tapIndex: 0 });
  await vi.waitFor(() => expect(picker).not.toBeNull());
  picker.success({
    tempFiles: [{ tempFilePath: 'wxfile://large.jpg', size: 6 * 1024 * 1024 }],
  });
  await capture;
  expect(upload).not.toHaveBeenCalled();
  expect(p.data.error).toContain('5 MB');
});
