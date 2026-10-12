import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('accepts an image-only message and blocks disconnected, busy and recording sends', async () => {
  vi.resetModules();
  let definition: any;
  vi.stubGlobal('Component', (value: any) => {
    definition = value;
  });
  await import('../src/components/composer/index');
  const triggerEvent = vi.fn();
  const view: any = {
    data: { ...definition.data },
    triggerEvent,
    setData(value: any) {
      Object.assign(this.data, value);
    },
  };
  const update =
    definition.observers?.['value, hasAttachments, busy, recording, connected'];
  expect(update).toBeTypeOf('function');
  update.call(view, '', true, false, false, true);
  definition.methods.send.call(view);
  expect(triggerEvent).toHaveBeenCalledExactlyOnceWith('send');
  for (const args of [
    ['', false, false, false, true],
    ['hello', false, true, false, true],
    ['hello', false, false, true, true],
    ['hello', false, false, false, false],
  ]) {
    update.call(view, ...args);
    definition.methods.send.call(view);
  }
  expect(triggerEvent).toHaveBeenCalledTimes(1);
});

it('uses one recorder owner across composer instances and cancels a hidden recording', async () => {
  vi.resetModules();
  const callbacks: Record<string, Function[]> = {
    start: [],
    stop: [],
    error: [],
  };
  const recorder = {
    onStart(fn: Function) {
      callbacks.start.push(fn);
    },
    onStop(fn: Function) {
      callbacks.stop.push(fn);
    },
    onError(fn: Function) {
      callbacks.error.push(fn);
    },
    start() {
      callbacks.start.forEach((fn) => fn());
    },
    stop() {
      callbacks.stop.forEach((fn) => fn({ tempFilePath: 'recording.mp3' }));
    },
  };
  const c: any = {
    storageKey: 'scope-one',
    upload: vi.fn(async () => ({ id: 'audio' })),
    mutate: vi.fn(async () => ({})),
    pending: () => [],
    saved: () => '',
  };
  const app = { client: c };
  vi.stubGlobal('getApp', () => app);
  vi.stubGlobal('wx', {
    getRecorderManager: () => recorder,
    showToast: () => {},
  });
  const { chatActions } = await import('../src/lib/chat-actions');
  // Page/component entries are bundled independently; they still share getApp().
  vi.resetModules();
  const { chatActions: otherEntryActions } = await import(
    '../src/lib/chat-actions'
  );
  const makeView = (methods: any) =>
    ({
      ...methods,
      data: {
        busy: false,
        recording: false,
        capabilities: { transcription: true },
      },
      setData(value: any) {
        Object.assign(this.data, value);
      },
    }) as any;
  const home = makeView(chatActions),
    plans = makeView(otherEntryActions);
  home.voice();
  home.cancelRecording();
  plans.voice();
  expect(home.data.recording).toBe(false);
  expect(plans.data.recording).toBe(true);
  plans.voice();
  await vi.waitFor(() => expect(c.mutate).toHaveBeenCalledTimes(1));
  expect(c.upload).toHaveBeenCalledTimes(1);
  expect(callbacks.stop).toHaveLength(1);
  home.voice();
  c.storageKey = 'scope-two';
  home.voice();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(c.upload).toHaveBeenCalledTimes(1);
});
