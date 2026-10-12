import { action, client, definePage } from '../../lib/page';
Page(
  definePage({
    data: { day: null },
    onLoad(q: any) {
      this._id = q.id;
    },
    beforeRefresh() {
      this.setData({ day: null });
    },
    async render(c: any) {
      if (!c.connected || !this._id) {
        this.setData({ day: null });
        return;
      }
      const day = await c.request(
        'GET',
        '/workout-days/' + encodeURIComponent(this._id),
      );
      this.setData({ day });
    },
    async start() {
      if (!this.data.day || this.data.day.status !== 'active') return;
      await action(this, async () => {
        const session = await client().mutate('/workout-sessions', {
          workout_day_id: this.data.day.id,
        });
        wx.navigateTo({
          url: '/pages/workout/index?id=' + encodeURIComponent(session.id),
        });
        return session;
      });
    },
    afterRetry(p: any, session: any) {
      if (p?.path === '/workout-sessions' && p.body.workout_day_id === this._id)
        wx.navigateTo({
          url: '/pages/workout/index?id=' + encodeURIComponent(session.id),
        });
    },
    plan() {
      wx.navigateTo({
        url:
          '/pages/plan-detail/index?id=' +
          encodeURIComponent(this.data.day.plan_id),
      });
    },
  }),
);
