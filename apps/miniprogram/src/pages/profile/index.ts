import { action, client, definePage } from '../../lib/page';
import { number } from '../../lib/view';
import { setupSummary } from '../../lib/onboarding';

Page(
  definePage({
    data: {
      points: [],
      latest: null,
      targets: [],
      memories: [],
      fitnessRows: [],
      setupCompleted: false,
      setupStarted: false,
    },
    async render(c: any) {
      const scope = c.storageKey;
      let points: any[] = [];
      if (c.connected)
        points = (await c.request('GET', '/trends?metric=weight_kg')).points;
      if (scope !== c.storageKey) return;
      this.setData({
        fitnessRows: c.data.profile?.fitness
          ? setupSummary(c.data.profile.fitness)
          : [],
        setupCompleted: c.data.profile?.onboarding_status === 'completed',
        setupStarted: !!c.data.profile?.fitness,
        points: points.slice(-8).map((point: any) => ({
          ...point,
          percent: Math.min(100, (point.value / 150) * 100),
        })),
        latest: points.at(-1) || null,
        targets: c.data.targets.slice(0, 6).map((target: any) => ({
          ...target,
          caloriesLabel: number(target.calories_kcal),
          statusLabel:
            target.status === 'active'
              ? '生效'
              : target.status === 'draft'
                ? '草案'
                : '历史版本',
        })),
        memories: c.data.memories.filter((memory: any) => !memory.deleted_at),
      });
    },
    beforeRefresh() {
      this.setData({ points: [], latest: null });
    },
    openSettings() {
      wx.navigateTo({ url: '/pages/settings/index' });
    },
    openAppearance() {
      wx.navigateTo({ url: '/pages/appearance/index' });
    },
    setup() {
      wx.navigateTo({ url: '/pages/onboarding/index' });
    },
    openEditor(e: any) {
      const { mode, id } = e.currentTarget.dataset;
      wx.navigateTo({
        url:
          '/pages/editor/index?mode=' +
          encodeURIComponent(mode) +
          (id ? '&id=' + encodeURIComponent(id) : ''),
      });
    },
    async forget(e: any) {
      const memory = this.data.memories.find(
        (item: any) => item.id === e.currentTarget.dataset.id,
      );
      if (!memory) return;
      await action(this, () =>
        client().mutate('/memories/' + memory.id + '/forget', {
          expected_version: memory.version,
        }),
      );
    },
  }),
);
