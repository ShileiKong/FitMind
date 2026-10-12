import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocalClient } from '../src/local/client';

let c: LocalClient, app: any, definition: any;
let commits: (() => void)[], ticks: (() => void)[];
let bottomTop: number;
let holdMeasurements: boolean, measurements: ((rects: any[]) => void)[];
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
  commits = [];
  ticks = [];
  bottomTop = 650;
  holdMeasurements = false;
  measurements = [];
  vi.stubGlobal('getApp', () => app);
  vi.stubGlobal('Page', (d: any) => {
    definition = d;
  });
  vi.stubGlobal('wx', {
    showToast: vi.fn(),
    getWindowInfo: () => ({ windowHeight: 700 }),
    nextTick: (fn: () => void) => ticks.push(fn),
    pageScrollTo: vi.fn(),
    createSelectorQuery: () => {
      const query: any = {
        in: () => query,
        select: () => query,
        boundingClientRect: () => query,
        exec: (fn: any) => {
          if (holdMeasurements) measurements.push(fn);
          else fn([{ top: bottomTop }]);
        },
      };
      return query;
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function page() {
  await import('../src/pages/chat/index');
  return {
    ...definition,
    data: structuredClone(definition.data),
    setData(v: any, committed?: () => void) {
      Object.assign(this.data, v);
      if (committed) commits.push(committed);
    },
  } as any;
}
function paint() {
  commits.splice(0).forEach((fn) => fn());
  ticks.splice(0).forEach((fn) => fn());
}
async function question(text: string) {
  await c.sendChat(text, {
    attachment_ids: [],
    workout_session_id: null,
    workout_exercise_id: null,
  });
  await c.refresh();
}

it('opens the full conversation at the latest message after native data commit and readiness', async () => {
  await question('喝了300毫升水');
  await question('喝了200毫升水');
  const p = await page();
  await p.onShow();
  expect(p.data.messages.at(-1).text).toBe('喝了200毫升水');
  expect(wx.pageScrollTo).not.toHaveBeenCalled();
  paint();
  p.onReady?.();
  paint();
  expect(wx.pageScrollTo).toHaveBeenLastCalledWith({
    selector: '#chat-bottom',
    duration: 0,
  });
  p.onUnload();
});

it('waits for the newest message data commit even if onReady arrives first', async () => {
  await question('喝了300毫升水');
  const p = await page();
  await p.onShow();
  p.onReady?.();
  ticks.splice(0).forEach((fn) => fn());
  expect(wx.pageScrollTo).not.toHaveBeenCalled();
  paint();
  expect(wx.pageScrollTo).toHaveBeenCalledTimes(1);
  p.onUnload();
});

it.each(['pending', 'running'])(
  'keeps a %s message visible before there is an assistant result',
  async (status) => {
    const p = await page();
    c.data.messages = [
      {
        message_id: 'awaiting-reply',
        text: '刚发出的新问题',
        status,
        result: null,
      },
    ];
    p.render(c);
    const latest = p.data.messages.at(-1);
    expect(latest.message_id).toBe('awaiting-reply');
    expect(latest.pending).toBe(true);
    expect(latest.showReply).toBe(true);
    expect(latest.receipts).toEqual([]);
  },
);

it('follows appended replies while at the bottom but preserves history reading during refreshes', async () => {
  await question('喝了300毫升水');
  const p = await page();
  await p.onShow();
  p.onReady?.();
  paint();
  vi.mocked(wx.pageScrollTo).mockClear();
  await question('喝了200毫升水');
  await p.load();
  paint();
  expect(wx.pageScrollTo).toHaveBeenCalledTimes(1);
  vi.mocked(wx.pageScrollTo).mockClear();
  bottomTop = 1600;
  p.onPageScroll({ scrollTop: 100 });
  await p.load();
  paint();
  expect(wx.pageScrollTo).not.toHaveBeenCalled();
  await question('喝了100毫升水');
  await p.load();
  paint();
  expect(wx.pageScrollTo).not.toHaveBeenCalled();
  bottomTop = 650;
  p.onPageScroll({ scrollTop: 1400 });
  await question('喝了50毫升水');
  await p.load();
  paint();
  expect(wx.pageScrollTo).toHaveBeenCalledTimes(1);
  p.onUnload();
});

it('does not pull unchanged history to the bottom on the sixty-second refresh', async () => {
  vi.useFakeTimers();
  await question('喝了300毫升水');
  const p = await page();
  await p.onShow();
  p.onReady?.();
  paint();
  vi.mocked(wx.pageScrollTo).mockClear();
  await vi.advanceTimersByTimeAsync(60000);
  paint();
  expect(wx.pageScrollTo).not.toHaveBeenCalled();
  p.onUnload();
});

it('follows a reply appended while the bottom viewport measurement is pending', async () => {
  await question('喝了300毫升水');
  const p = await page();
  await p.onShow();
  p.onReady?.();
  paint();
  vi.mocked(wx.pageScrollTo).mockClear();
  holdMeasurements = true;
  p.onPageScroll({ scrollTop: 1000 });
  await question('喝了200毫升水');
  await p.load();
  paint();
  expect(wx.pageScrollTo).not.toHaveBeenCalled();
  measurements.splice(0).forEach((fn) => fn([{ top: 650 }]));
  paint();
  expect(wx.pageScrollTo).toHaveBeenCalledTimes(1);
  p.onUnload();
});

it('returns to the latest reply when the user sends from history', async () => {
  await question('喝了300毫升水');
  const p = await page();
  await p.onShow();
  p.onReady?.();
  paint();
  bottomTop = 1600;
  p.onPageScroll({ scrollTop: 100 });
  vi.mocked(wx.pageScrollTo).mockClear();
  p.input({ detail: { value: '喝了100毫升水' } });
  await p.send();
  paint();
  expect(p.data.messages.at(-1).text).toBe('喝了100毫升水');
  expect(wx.pageScrollTo).toHaveBeenCalledTimes(1);
  p.onUnload();
});

it('keeps following a sent message through a viewport event before its answer is painted', async () => {
  await question('喝了300毫升水');
  const p = await page();
  await p.onShow();
  p.onReady?.();
  paint();
  bottomTop = 1600;
  p.onPageScroll({ scrollTop: 100 });
  vi.mocked(wx.pageScrollTo).mockClear();
  const run = c.agent.run.bind(c.agent);
  let finish!: () => void;
  c.agent.run = (request) =>
    new Promise((resolve) => {
      finish = () => void run(request).then(resolve);
    });
  p.input({ detail: { value: '喝了100毫升水' } });
  const sending = p.send();
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  p.onPageScroll({ scrollTop: 110 });
  finish();
  await sending;
  paint();
  expect(p.data.messages.at(-1).text).toBe('喝了100毫升水');
  expect(wx.pageScrollTo).toHaveBeenCalledTimes(1);
  p.onUnload();
});

it('shows the actual queued question and processing card while a real send is held', async () => {
  const p = await page();
  await p.onShow();
  p.onReady?.();
  paint();
  vi.mocked(wx.pageScrollTo).mockClear();
  const run = c.agent.run.bind(c.agent);
  let finish!: () => void;
  c.agent.run = (request) =>
    new Promise((resolve) => {
      finish = () => void run(request).then(resolve);
    });
  p.input({ detail: { value: '喝了100毫升水' } });
  const sending = p.send();
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  expect(c.data.messages).toHaveLength(0);
  const queued = c.pending()[0];
  expect(queued.body.text).toBe('喝了100毫升水');
  await vi.waitFor(() =>
    expect(p.data.messages.at(-1)?.text).toBe('喝了100毫升水'),
  );
  expect(p.data.messages.at(-1).message_id).toBe(queued.body.message_id);
  expect(p.data.messages.at(-1).pending).toBe(true);
  expect(p.data.messages.at(-1).showReply).toBe(true);
  expect(p.data.pending[0].id).toBe(queued.id);
  expect(p.data.busy).toBe(true);
  paint();
  expect(wx.pageScrollTo).toHaveBeenCalledTimes(1);
  finish();
  await sending;
  paint();
  expect(p.data.messages).toHaveLength(1);
  expect(p.data.messages[0].pending).toBe(false);
  expect(p.data.messages[0].receipts[0].label).toContain('已保存 · 100 毫升水');
  expect(p.data.pending).toHaveLength(0);
  expect(c.data.records).toHaveLength(1);
  p.onUnload();
});

it('invalidates delayed scrolling on hide, then scrolls after reopening', async () => {
  await question('喝了300毫升水');
  const p = await page();
  await p.onShow();
  p.onReady?.();
  p.onHide();
  paint();
  expect(wx.pageScrollTo).not.toHaveBeenCalled();
  await p.onShow();
  paint();
  expect(wx.pageScrollTo).toHaveBeenCalledTimes(1);
  p.onUnload();
});

it('discards an old scope scroll after a real backup import', async () => {
  const backup = c.exportBackup();
  await question('喝了300毫升水');
  const p = await page();
  await p.onShow();
  p.onReady?.();
  await c.importBackup(backup);
  paint();
  expect(wx.pageScrollTo).not.toHaveBeenCalled();
  await p.load();
  paint();
  expect(p.data.messages).toHaveLength(0);
  expect(wx.pageScrollTo).toHaveBeenCalledTimes(1);
  p.onUnload();
});

it('does not let an old client completion cancel the new client queued-input projection', async () => {
  vi.useFakeTimers();
  const p = await page();
  await p.onShow();
  p.onReady?.();
  paint();
  const old = c,
    runOld = old.agent.run.bind(old.agent);
  let finishOld!: () => void;
  old.agent.run = (request) =>
    new Promise((resolve) => {
      finishOld = () => void runOld(request).then(resolve);
    });
  p.input({ detail: { value: '喝了300毫升水' } });
  const oldSending = p.send();
  await vi.advanceTimersByTimeAsync(0);
  expect(finishOld).toBeTypeOf('function');
  c = phone();
  await c.importBackup(c.exportBackup());
  app.client = c;
  await p.load();
  expect(p.data.busy).toBe(false);
  const time = c.time.bind(c);
  let contextReady!: () => void;
  c.time = () =>
    new Promise((resolve) => {
      contextReady = () => void time().then(resolve);
    });
  const runNew = c.agent.run.bind(c.agent);
  let finishNew!: () => void;
  c.agent.run = (request) =>
    new Promise((resolve) => {
      finishNew = () => void runNew(request).then(resolve);
    });
  p.input({ detail: { value: '喝了50毫升水' } });
  const newSending = p.send();
  await vi.advanceTimersByTimeAsync(0);
  finishOld();
  await oldSending;
  contextReady();
  await vi.advanceTimersByTimeAsync(50);
  expect(p.data.messages.at(-1)?.text).toBe('喝了50毫升水');
  expect(p.data.pending[0].body.text).toBe('喝了50毫升水');
  expect(
    p.data.messages.some((message: any) => message.text === '喝了300毫升水'),
  ).toBe(false);
  c.time = time;
  finishNew();
  await newSending;
  p.onUnload();
});
