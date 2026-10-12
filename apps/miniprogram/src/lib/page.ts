import type { MiniClient } from './client';
import type { LocalClient } from '../local/client';
import { syncAppearance, themedPage } from './appearance';
export function client(): MiniClient | LocalClient {
  return (getApp() as any).client;
}
export async function action(
  page: any,
  work: () => Promise<any>,
  success?: string,
) {
  if (page.data.busy) return;
  const c = client(),
    scope = c.storageKey;
  const current = () =>
    client() === c && c.storageKey === scope && !page._dockDetached;
  page.setData({ busy: true, error: '' });
  try {
    const result = await work();
    if (!current()) return;
    if (success) wx.showToast({ title: success, icon: 'success' });
    await page.load?.();
    return result;
  } catch (e: any) {
    if (current()) page.setData({ error: e.message || '操作失败，请重试' });
  } finally {
    if (current()) page.setData({ busy: false, pending: c.pending() });
  }
}
export function definePage(extra: any) {
  return themedPage({
    async onShow(this: any) {
      this._visible = true;
      await this.load();
      if (!this._visible) return;
      clearInterval(this._timer);
      this._timer = setInterval(() => {
        if (!this.data.busy) void this.load();
      }, 60000);
    },
    onHide(this: any) {
      this._visible = false;
      clearInterval(this._timer);
    },
    onUnload(this: any) {
      this._visible = false;
      clearInterval(this._timer);
    },
    async onPullDownRefresh(this: any) {
      await this.load();
      wx.stopPullDownRefresh();
    },
    onPageScroll(this: any) {
      this.getTabBar?.()?.collapsePreview?.({ reason: 'page-scroll' });
      this.selectComponent?.('#coach-dock')?.collapsePreview?.({
        reason: 'page-scroll',
      });
    },
    async load(this: any) {
      const c = client();
      if (this._scope !== c.storageKey) {
        this._scope = c.storageKey;
        this.setData(JSON.parse(JSON.stringify(extra.data || {})));
      }
      syncAppearance(this);
      this.setData({ connected: c.connected, pending: c.pending() });
      if (!c.connected) {
        await extra.render?.call(this, c);
        this.getTabBar?.()?.sync?.();
        this.selectComponent?.('#coach-dock')?.sync?.();
        this.setData({ error: '先到「我的」连接个人服务', loading: false });
        return;
      }
      if (this._loading) return;
      this._loading = true;
      this.setData({ loading: true });
      extra.beforeRefresh?.call(this, c);
      try {
        await c.refresh();
        await extra.render?.call(this, c);
        this.setData({ error: '' });
      } catch (e: any) {
        try {
          await extra.render?.call(this, c);
        } catch {
          /* Keep the original connection error visible. */
        }
        this.setData({ error: e.message || '暂时无法连接服务' });
      } finally {
        this._loading = false;
        this.setData({ loading: false, pending: c.pending() });
        this.getTabBar?.()?.sync?.();
        this.selectComponent?.('#coach-dock')?.sync?.();
      }
    },
    openSettings() {
      wx.navigateTo({ url: '/pages/settings/index' });
    },
    openChat(this: any, e: any) {
      if (e?.currentTarget?.dataset?.prompt)
        client().save('draft', e.currentTarget.dataset.prompt);
      wx.navigateTo({ url: '/pages/chat/index' });
    },
    async retryInput(this: any, e: any) {
      await action(
        this,
        async () => {
          const id = e.detail?.id || e.currentTarget.dataset.id;
          const p = client()
            .pending()
            .find((p) => p.id === id);
          const result = await client().retry(id);
          extra.afterRetry?.call(this, p, result);
          return result;
        },
        '已处理',
      );
    },
    async discardInput(this: any, e: any) {
      wx.showModal({
        title: '移除待处理输入',
        content:
          '请先刷新确认是否已有回执。移除待处理输入不会撤销已经保存的数据。',
        success: async (r) => {
          if (r.confirm) {
            client().discard(e.detail?.id || e.currentTarget.dataset.id);
            this.setData({ pending: client().pending() });
          }
        },
      });
    },
    ...extra,
    data: {
      busy: false,
      loading: false,
      error: '',
      connected: false,
      pending: [],
      ...extra.data,
    },
  });
}
