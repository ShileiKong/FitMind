import { definePage } from '../../lib/page';
Page(
  definePage({
    data: {},
    render() {},
    choose(e: any) {
      try {
        (getApp() as any).appearance.select(e.currentTarget.dataset.skin);
        this.setData({ error: '' });
        wx.showToast({ title: '皮肤已切换', icon: 'success' });
      } catch (error: any) {
        this.setData({ error: error.message || '切换失败，请重试。' });
      }
    },
  }),
);
