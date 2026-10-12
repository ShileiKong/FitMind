import { action, client } from './page';

// RecorderManager is global in WeChat. Only the component that started a
// recording may consume its callbacks, even after navigating to another page.
type Registry = {
  recorder: WechatMiniprogram.RecorderManager | null;
  owner: {
    view: any;
    scope: string;
    cancelled: boolean;
    stopping: boolean;
  } | null;
};
function registry(): Registry {
  // Separate page bundles have separate module globals, but one App instance.
  const app = getApp() as any;
  return (
    app._recordingRegistry ??
    (app._recordingRegistry = { recorder: null, owner: null })
  );
}
function manager() {
  const state = registry();
  if (state.recorder) return state.recorder;
  const recorder = (state.recorder = wx.getRecorderManager());
  recorder.onStart(() => {
    if (state.owner) state.owner.view.setData({ recording: true, error: '' });
  });
  recorder.onError(() => {
    const current = state.owner;
    state.owner = null;
    current?.view.setData({
      recording: false,
      error: current.cancelled ? '' : '无法开始录音，请检查麦克风权限。',
    });
  });
  recorder.onStop(async (result) => {
    const current = state.owner;
    state.owner = null;
    if (!current) return;
    current.view.setData({ recording: false });
    const c = client();
    if (current.cancelled || current.scope !== c.storageKey) return;
    await action(
      current.view,
      async () => {
        const asset = await c.upload('/media/audio', result.tempFilePath);
        if (current.scope !== c.storageKey) return;
        await c.mutate('/audio/transcriptions', { asset_id: asset.id });
        if (current.scope === c.storageKey)
          current.view.setData({ draft: c.saved('draft', '') });
      },
      '转写完成',
    );
  });
  return recorder;
}
export function voice(view: any) {
  if (view.data.busy) return;
  const state = registry();
  const owner = state.owner;
  if (owner) {
    if (owner.view !== view) {
      view.setData({ error: '另一处正在录音，请先结束录音。' });
      return;
    }
    if (!owner.stopping) {
      owner.stopping = true;
      manager().stop();
    }
    return;
  }
  if (!view.data.capabilities?.transcription) {
    view.setData({ error: '语音转写尚未配置，可以使用键盘的语音听写输入。' });
    return;
  }
  const r = manager();
  state.owner = {
    view,
    scope: client().storageKey,
    cancelled: false,
    stopping: false,
  };
  view.setData({ recording: true, error: '' });
  r.start({
    duration: 60000,
    format: 'mp3',
    sampleRate: 16000,
    numberOfChannels: 1,
    encodeBitRate: 48000,
  });
}
export function cancelRecording(view: any) {
  const owner = registry().owner;
  if (!owner || owner.view !== view) return;
  owner.cancelled = true;
  if (!owner.stopping) {
    owner.stopping = true;
    manager().stop();
  }
}
