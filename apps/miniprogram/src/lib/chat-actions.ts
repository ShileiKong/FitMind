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
    if (
      this.data.busy ||
      this._photoPicking ||
      this._dockDetached ||
      this._dockHidden ||
      this._visible === false
    )
      return;
    const images = this.data.attachments.filter(
      (a: any) => a.id !== e.currentTarget.dataset.id,
    );
    client().save('attachments', images);
    this.setData({ attachments: images });
  },
  async photo() {
    if (this.data.busy || this.data.recording || this._photoPicking) return;
    const c = client(),
      scope = c.storageKey;
    const current = () =>
      client() === c &&
      c.storageKey === scope &&
      !this._dockDetached &&
      !this._dockHidden &&
      this._visible !== false;
    if (!current()) return;
    if (!this.data.capabilities?.vision) {
      this.setData({
        error: (c as any).isLocal
          ? '请到「我的」配置 DeepSeek API Key，并选择支持照片的 DeepSeek flash 模型。'
          : '照片识别尚未配置，请先用文字描述或营养标签记录。',
      });
      return;
    }
    if (!(c as any).isLocal && this.data.attachments.length >= 3) {
      this.setData({ error: '每条消息最多附 3 张照片' });
      return;
    }
    this._photoPicking = true;
    try {
      let mode = 'meal';
      if ((c as any).isLocal) {
        const choice = await new Promise<any>((resolve, reject) =>
          wx.showActionSheet({
            itemList: ['拍餐食 · 估算营养', '拍营养表 · 按食用量计算'],
            success: resolve,
            fail: (error) =>
              error.errMsg?.includes('cancel')
                ? resolve(null)
                : reject(new Error('无法打开照片菜单，请重试。')),
          }),
        );
        if (!choice || !current()) return;
        mode = choice.tapIndex === 1 ? 'label' : 'meal';
      }
      const result = await new Promise<any>((resolve, reject) =>
        wx.chooseMedia({
          count: 1,
          mediaType: ['image'],
          sourceType: ['camera', 'album'],
          sizeType: ['compressed'],
          success: resolve,
          fail: (error) =>
            error.errMsg?.includes('cancel')
              ? resolve(null)
              : reject(
                  new Error('无法打开相机或相册，请检查微信照片与相机权限。'),
                ),
        }),
      );
      if (!result?.tempFiles?.length || !current()) return;
      const f = result.tempFiles[0];
      const limitMB = (c as any).isLocal ? 5 : 20;
      if (f.size > limitMB * 1024 * 1024)
        throw new Error('图片太大，请选择小于 ' + limitMB + ' MB 的图片');
      const asset = await c.upload(
        '/media/images',
        f.tempFilePath,
        commandId(),
      );
      if (!current()) return;
      if ((c as any).isLocal) {
        wx.navigateTo({
          url:
            '/pages/photo-review/index?asset=' +
            encodeURIComponent(asset.id) +
            '&mode=' +
            mode,
        });
        return;
      }
      const images = [
        ...this.data.attachments,
        { id: asset.id, path: f.tempFilePath },
      ];
      c.save('attachments', images);
      this.setData({ attachments: images });
    } catch (error: any) {
      if (current())
        this.setData({ error: error.message || '照片处理失败，请重试。' });
    } finally {
      this._photoPicking = false;
    }
  },
  voice() {
    voice(this);
  },
  cancelRecording() {
    cancelRecording(this);
  },
};
