import { voice, cancelRecording } from './recording';
import { client, action } from './page';
import { commandId } from './client';
import { proposalActions } from './proposal-actions';
export const chatActions: Record<string, (this: any, ...args: any[]) => any> = {
  ...proposalActions,
  input(e: any) {
    client().save('draft', e.detail.value);
    this.setData({ draft: e.detail.value });
  },
  expand(e: any) {
    const id = e.currentTarget.dataset.id;
    this.setData({ ['expanded.' + id]: !this.data.expanded[id] });
  },
  async send() {
    if (this.data.busy) return;
    const c = client(),
      scope = c.storageKey;
    const text = this.data.draft;
    this.beginPreview?.(text);
    await action(this, async () => {
      if (c.pending().some((p) => p.path === '/chat'))
        throw new Error('上一条输入尚未确认，请先查看回执并重试。');
      const attachments = this.data.attachments.map((a: any) => a.id);
      const result = await c.sendChat(text, {
        attachment_ids: attachments,
        workout_session_id: this.data.active?.id ?? null,
        workout_exercise_id: this.data.active?.current_exercise_id ?? null,
      });
      if (client() === c && c.storageKey === scope && !this._dockDetached)
        this.setData({
          draft: c.saved('draft', ''),
          attachments: c.saved('attachments', []),
        });
      return result;
    });
    this.finishPreview?.(c, scope);
  },
  async recover(e: any) {
    await action(this, () =>
      client().mutate(
        '/messages/' + e.currentTarget.dataset.id + '/recover',
        {},
      ),
    );
  },
  removePhoto(e: any) {
    const images = this.data.attachments.filter(
      (a: any) => a.id !== e.currentTarget.dataset.id,
    );
    client().save('attachments', images);
    this.setData({ attachments: images });
  },
  async photo() {
    if (this.data.busy || this.data.recording) return;
    if (!this.data.capabilities?.vision) {
      this.setData({
        error: '照片识别尚未配置，请先用文字描述或营养标签记录。',
      });
      return;
    }
    if (this.data.attachments.length >= 3) {
      this.setData({ error: '每条消息最多附 3 张照片' });
      return;
    }
    const result = await new Promise<any>((resolve) =>
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
        success: resolve,
        fail: () => resolve(null),
      }),
    );
    if (!result) return;
    await action(this, async () => {
      const f = result.tempFiles[0];
      if (f.size > 20 * 1024 * 1024)
        throw new Error('图片太大，请选择小于 20 MB 的图片');
      const asset = await client().upload(
        '/media/images',
        f.tempFilePath,
        commandId(),
      );
      const images = [
        ...this.data.attachments,
        { id: asset.id, path: f.tempFilePath },
      ];
      client().save('attachments', images);
      this.setData({ attachments: images });
    });
  },
  voice() {
    voice(this);
  },
  cancelRecording() {
    cancelRecording(this);
  },
};
