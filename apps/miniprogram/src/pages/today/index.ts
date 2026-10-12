import { client, definePage, action } from '../../lib/page';
import { budgetKeys, budgetView, recordView, positive } from '../../lib/view';
Page(
  definePage({
    data: {
      date: '',
      timezone: '',
      budgets: budgetKeys.map((k) => budgetView(k, null)),
      records: [],
      water: '250',
      today: [],
      active: null,
      reminder: null,
      showSetup: false,
      setupStarted: false,
      trainingGoal: null,
      nextTraining: null,
      dietApplied: false,
      day: null,
      trainingText: '',
    },
    beforeRefresh() {
      this.setData({
        date: '',
        budgets: budgetKeys.map((k) => budgetView(k, null)),
        records: [],
        today: [],
        active: null,
        trainingGoal: null,
        nextTraining: null,
        dietApplied: false,
        day: null,
        trainingText: '',
      });
    },
    render(c: any) {
      const date = c.data.context?.local_date || '';
      const days = c.data.days.filter((d: any) => d.status === 'active');
      const day = days.find((d: any) => d.local_date === date) || null;
      const trainingGoal =
        c.data.plans.find((p: any) => {
          const dates = p.days.map((d: any) => d.local_date).sort();
          return (
            p.status === 'active' &&
            (p.period?.start_date || dates[0]) <= date &&
            (p.period?.end_date || dates.at(-1)) >= date
          );
        }) || null;
      this.setData({
        trainingGoal,
        nextTraining: trainingGoal
          ? days
              .filter(
                (d: any) =>
                  d.plan_id === trainingGoal.id && d.local_date > date,
              )
              .sort((a: any, b: any) =>
                a.local_date.localeCompare(b.local_date),
              )[0] || null
          : null,
        dietApplied: !!c.data.context?.target,
        date: c.data.context?.local_date || '',
        timezone: c.data.context?.timezone || '',
        budgets: budgetKeys.map((k) => budgetView(k, c.data.summary?.[k])),
        records: c.data.records
          .filter((r: any) => !r.undone_at)
          .map(recordView),
        today: days.filter(
          (d: any) => d.local_date === c.data.context?.local_date,
        ),
        active: c.data.context?.active_workout || null,
        reminder: c.reminder || null,
        showSetup: !['completed', 'skipped'].includes(
          c.data.profile?.onboarding_status,
        ),
        setupStarted: !!c.data.profile?.fitness,
        day,
        trainingText:
          day?.exercises
            .map((e: any) => e.name + ' ' + e.sets + '组')
            .join(' / ') || '',
      });
    },
    inputWater(e: any) {
      this.setData({ water: e.detail.value });
    },
    setup() {
      wx.navigateTo({ url: '/pages/onboarding/index' });
    },
    async addWater(e: any) {
      await action(
        this,
        async () => {
          const amount_ml = positive(
            e.currentTarget.dataset.amount || this.data.water,
            '饮水量',
          );
          const c = await client().time();
          return client().mutate('/records', {
            kind: 'water',
            amount_ml,
            local_date: c.local_date,
            occurred_at: c.now_utc,
          });
        },
        '饮水已记录',
      );
    },
    food() {
      wx.navigateTo({ url: '/pages/editor/index?mode=food' });
    },
    nutritionDetails(e: any) {
      const key = e.currentTarget.dataset.key;
      if (!budgetKeys.includes(key) || !this.data.date) return;
      wx.navigateTo({
        url:
          '/pages/nutrient-detail/index?key=' +
          key +
          '&date=' +
          encodeURIComponent(this.data.date),
      });
    },
    tomorrowTraining() {
      if (this.data.reminder)
        wx.navigateTo({
          url:
            '/pages/day/index?id=' + encodeURIComponent(this.data.reminder.id),
        });
    },
    training() {
      if (this.data.day)
        wx.navigateTo({
          url: '/pages/plan-detail/index?id=' + this.data.day.plan_id,
        });
      else if (this.data.trainingGoal)
        wx.navigateTo({
          url: '/pages/plan-detail/index?id=' + this.data.trainingGoal.id,
        });
      else wx.switchTab({ url: '/pages/plans/index' });
    },
    edit(e: any) {
      wx.navigateTo({
        url: '/pages/editor/index?mode=' + e.currentTarget.dataset.mode,
      });
    },
    editRecord(e: any) {
      const r = this.data.records.find(
        (r: any) => r.id === e.currentTarget.dataset.id,
      );
      if (r)
        wx.navigateTo({
          url:
            '/pages/editor/index?mode=' +
            r.kind +
            '&id=' +
            encodeURIComponent(r.id),
        });
    },
    async undoRecord(e: any) {
      const r = this.data.records.find(
        (r: any) => r.id === e.currentTarget.dataset.id,
      );
      if (r)
        await action(
          this,
          () =>
            client().mutate('/records/' + r.id + '/undo', {
              expected_version: r.version,
            }),
          '已撤销',
        );
    },
  }),
);
