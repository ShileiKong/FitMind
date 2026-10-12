import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalClient } from '../src/local/client';

let c: LocalClient, app: any, keyboard: any, definition: any;
const at = () => new Date('2026-10-11T10:00:00Z');
function phone() {
  const storage = new Map<string, any>();
  return new LocalClient(
    {
      getStorageSync: (k: string) => structuredClone(storage.get(k)),
      setStorageSync: (k: string, v: any) => storage.set(k, structuredClone(v)),
      removeStorageSync: (k: string) => storage.delete(k),
    },
    at,
  );
}
beforeEach(async () => {
  vi.resetModules();
  c = phone();
  await c.refresh();
  app = { client: c };
  keyboard = null;
  vi.stubGlobal('getApp', () => app);
  vi.stubGlobal('getCurrentPages', () => [
    { route: 'pages/today/index', load: () => app.client.refresh() },
  ]);
  vi.stubGlobal('Component', (d: any) => {
    definition = d;
  });
  vi.stubGlobal('wx', {
    onKeyboardHeightChange: vi.fn((f: any) => {
      keyboard = f;
    }),
    offKeyboardHeightChange: vi.fn(),
    getWindowInfo: () => ({ windowHeight: 700 }),
    hideKeyboard: vi.fn(),
    showToast: vi.fn(),
    navigateTo: vi.fn(),
    switchTab: vi.fn(),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function dock(entry: string) {
  if (entry === 'tab') await import('../src/custom-tab-bar/index');
  else await import('../src/components/coach-dock/index');
  const d: any = {
    ...definition.methods,
    data: structuredClone(definition.data),
    setData(v: any) {
      Object.assign(this.data, v);
    },
  };
  const lifetimes = definition.lifetimes;
  lifetimes.attached.call(d);
  return { d, lifetimes };
}

describe.each(['tab', 'workout'])('%s coach preview', (entry) => {
  it('focus expands, main scrolling collapses without losing a saved draft, and conversation remains accessible', async () => {
    const { d } = await dock(entry);
    d.input({ detail: { value: '未发送的想法' } });
    d.focusComposer();
    expect(d.data.previewOpen).toBe(true);
    const { definePage } = await import('../src/lib/page');
    const page = {
      ...definePage({}),
      getTabBar: () => (entry === 'tab' ? d : null),
      selectComponent: () => (entry === 'workout' ? d : null),
    };
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000);
    page.onPageScroll({ scrollTop: 120 });
    expect(d.data.previewOpen).toBe(false);
    expect(d.data.draft).toBe('未发送的想法');
    expect(c.saved('draft', '')).toBe('未发送的想法');
    d.openChat();
    expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/chat/index' });
  });

  it('keeps preview visible through keyboard repositioning and internal scroll, and releases its listener on detach', async () => {
    const { d, lifetimes } = await dock(entry);
    d.focusComposer();
    keyboard({ height: 300 });
    d.collapsePreview({ reason: 'page-scroll' });
    expect(d.data.previewOpen).toBe(true);
    expect(d.data.keyboardHeight).toBe(300);
    expect(d.data.previewHeight + 300 + 180).toBeLessThanOrEqual(700);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000);
    d.previewTouchStart();
    d.previewTouchMove();
    d.previewScroll();
    d.collapsePreview({ reason: 'page-scroll' });
    expect(d.data.previewOpen).toBe(true);
    d.previewTouchEnd();
    expect(d.data.previewOpen).toBe(true);
    lifetimes.detached.call(d);
    expect(wx.offKeyboardHeightChange).toHaveBeenCalledExactlyOnceWith(
      keyboard,
    );
    keyboard({ height: 350 });
    expect(d.data.keyboardHeight).toBe(300);
  });

  it('expands while sending and retains the actual saved water receipt after completion', async () => {
    const { d } = await dock(entry);
    const run = c.agent.run.bind(c.agent);
    let finish!: () => void;
    c.agent.run = (request) =>
      new Promise((resolve) => {
        finish = () => void run(request).then(resolve);
      });
    d.input({ detail: { value: '喝了300毫升水' } });
    const sending = d.send();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(d.data.previewOpen).toBe(true);
    expect(d.data.preview.pending).toBe(true);
    expect(d.data.preview.text).toBe('喝了300毫升水');
    finish();
    await sending;
    expect(d.data.previewOpen).toBe(true);
    expect(d.data.preview.pending).toBe(false);
    expect(d.data.preview.receipts[0].label).toContain('已保存 · 300 毫升水');
    expect(c.data.summary.water_ml.known_total).toBe(300);
    expect(d.data.draft).toBe('');
    expect(c.pending()).toHaveLength(0);
  });

  it('shows a lost response, preserves the draft, and retries without duplicating a record', async () => {
    const { d } = await dock(entry);
    const run = c.agent.run.bind(c.agent);
    let lost = true;
    c.agent.run = async (request) => {
      const result = await run(request);
      if (lost) {
        lost = false;
        throw new Error('回复连接中断');
      }
      return result;
    };
    d.input({ detail: { value: '喝了300毫升水' } });
    await d.send();
    expect(d.data.previewOpen).toBe(true);
    expect(d.data.preview.errors).toContain('回复连接中断');
    expect(d.data.draft).toBe('喝了300毫升水');
    expect(c.pending()).toHaveLength(1);
    await c.refresh();
    d.sync();
    expect(d.data.preview.receipts).toHaveLength(1);
    expect(d.data.preview.errors).toContain('回复连接中断');
    await d.retry();
    expect(d.data.preview.errors).toHaveLength(0);
    expect(d.data.preview.receipts).toHaveLength(1);
    expect(c.data.records).toHaveLength(1);
    expect(c.pending()).toHaveLength(0);
  });

  it('shows a brief answer with genuine proposal and tool error entries', async () => {
    const { d } = await dock(entry);
    const target = await c.mutate('/targets/drafts', {
      effective_from: '2026-10-11',
      calories_kcal: 2000,
      water_ml: null,
      carbs_g: null,
      protein_g: null,
      fat_g: null,
    });
    c.data.messages = [
      {
        message_id: 'latest',
        text: '制定目标',
        status: 'completed',
        result: {
          assistant_text:
            '建议先从每天 2000 千卡开始。\n\n' + '详细说明。'.repeat(100),
          record_receipts: [],
          proposals: [{ ...target, type: 'target' }],
          tool_errors: [{ code: 'INVALID_TOOL_ARGUMENTS', message: 'bad' }],
        },
      },
    ];
    d.sync();
    d.focusComposer();
    expect(d.data.preview.answer.length).toBeLessThan(220);
    expect(d.data.preview.proposals[0].id).toBe(target.id);
    expect(d.data.preview.errors[0]).toContain('没有完成');
    d.proposal({
      currentTarget: { dataset: { id: target.id, type: 'target' } },
    });
    expect(wx.navigateTo).toHaveBeenLastCalledWith({
      url: '/pages/editor/index?mode=target&id=' + target.id,
    });
  });

  it('shows the latest queued question after reopening instead of an older answer', async () => {
    const { d } = await dock(entry);
    d.input({ detail: { value: '喝了300毫升水' } });
    await d.send();
    c.save('pending', [
      {
        id: 'queue-new',
        path: '/chat',
        method: 'POST',
        body: { message_id: 'new-message', text: '晚饭吃了牛肉面' },
        error: '等待网络恢复',
      },
    ]);
    d.sync();
    d.focusComposer();
    expect(d.data.preview.text).toBe('晚饭吃了牛肉面');
    expect(d.data.preview.receipts).toHaveLength(0);
    expect(d.data.preview.errors).toContain('等待网络恢复');
  });

  it('clears the old scope preview and ignores a late completion after data changes', async () => {
    const { d } = await dock(entry);
    const run = c.agent.run.bind(c.agent);
    let finish!: () => void;
    c.agent.run = (request) =>
      new Promise((resolve) => {
        finish = () => void run(request).then(resolve);
      });
    d.input({ detail: { value: '喝了300毫升水' } });
    const sending = d.send();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    app.client = phone();
    await app.client.refresh();
    app.client.save('draft', '新资料的输入');
    d.sync();
    expect(d.data.previewOpen).toBe(false);
    expect(d.data.preview).toBeNull();
    expect(d.data.error).toBe('');
    finish();
    await sending;
    expect(d.data.preview).toBeNull();
    expect(d.data.draft).toBe('新资料的输入');
    expect(d.data.busy).toBe(false);
  });

  it('clears draft and reply after a real backup import changes the data scope', async () => {
    const emptyBackup = c.exportBackup();
    const { d } = await dock(entry);
    d.input({ detail: { value: '喝了300毫升水' } });
    await d.send();
    expect(d.data.preview.receipts).toHaveLength(1);
    d.input({ detail: { value: '还没发送' } });
    const oldScope = c.storageKey;
    await c.importBackup(emptyBackup);
    d.sync();
    expect(c.storageKey).not.toBe(oldScope);
    expect(d.data.preview).toBeNull();
    expect(d.data.previewOpen).toBe(false);
    expect(d.data.draft).toBe('');
  });

  it('lets a hidden request finish without reopening its preview or losing the new draft', async () => {
    const { d } = await dock(entry);
    const lifetimes = definition.pageLifetimes;
    const run = c.agent.run.bind(c.agent);
    let finish!: () => void;
    c.agent.run = (request) =>
      new Promise((resolve) => {
        finish = () => void run(request).then(resolve);
      });
    d.input({ detail: { value: '喝了300毫升水' } });
    const sending = d.send();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    lifetimes.hide.call(d);
    c.save('draft', '切换页面后的新输入');
    finish();
    await sending;
    expect(d.data.previewOpen).toBe(false);
    lifetimes.show.call(d);
    expect(d.data.draft).toBe('切换页面后的新输入');
    expect(d.data.preview.receipts).toHaveLength(1);
    expect(c.data.records).toHaveLength(1);
    expect(c.pending()).toHaveLength(0);
  });
});

it('composer emits optional focus and keyboard events without sending or changing its draft', async () => {
  await import('../src/components/composer/index');
  const triggerEvent = vi.fn();
  definition.methods.focus.call({ triggerEvent });
  definition.methods.keyboard.call(
    { triggerEvent },
    { detail: { height: 280 } },
  );
  expect(triggerEvent.mock.calls).toEqual([
    ['focus'],
    ['keyboard', { height: 280 }],
  ]);
  expect(definition.properties.adjustPosition.value).toBe(true);
});
