import { definePage } from '../../lib/page';
Page(
  definePage({
    data: { sessions: [] },
    beforeRefresh() {
      this.setData({ sessions: [] });
    },
    async render(c: any) {
      if (!c.connected) {
        this.setData({ sessions: [] });
        return;
      }
      const sessions = await c.request('GET', '/workout-sessions');
      this.setData({
        sessions: sessions.map((s: any) => {
          const sets = s.sets.filter((set: any) => !set.undone_at);
          return {
            ...s,
            setCount: sets.length,
            repCount: sets.reduce((n: number, set: any) => n + set.reps, 0),
            statusLabel: (
              {
                active: '进行中',
                paused: '已暂停',
                completed: '已完成',
                abandoned: '已结束',
              } as any
            )[s.status],
            continuing: ['active', 'paused'].includes(s.status),
          };
        }),
      });
    },
    detail(e: any) {
      wx.navigateTo({
        url:
          '/pages/workout/index?id=' +
          encodeURIComponent(e.currentTarget.dataset.id),
      });
    },
    plans() {
      wx.switchTab({ url: '/pages/plans/index' });
    },
  }),
);
