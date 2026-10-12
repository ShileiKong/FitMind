import { action, client } from './page';

const selection = (e: any) =>
  e?.detail?.id ? e.detail : e?.currentTarget?.dataset || e?.detail || {};
export const proposalActions: Record<
  string,
  (this: any, ...args: any[]) => any
> = {
  proposal(e: any) {
    const { type, id } = selection(e);
    wx.navigateTo({
      url:
        type === 'target'
          ? '/pages/editor/index?mode=target&id=' + encodeURIComponent(id)
          : '/pages/plan-detail/index?id=' + encodeURIComponent(id),
    });
  },
  async confirmProposal(e: any) {
    const { type, id, version } = selection(e);
    const c = client(),
      scope = c.storageKey;
    const result = await action(
      this,
      async () => {
        if (
          !['target', 'plan'].includes(type) ||
          !id ||
          !Number.isInteger(Number(version)) ||
          Number(version) < 1
        )
          throw new Error('请查看详情，确认这份目标。');
        const path =
          '/' +
          (type === 'target' ? 'targets' : 'plans') +
          '/' +
          encodeURIComponent(id) +
          '/confirm';
        const queued = c
          .pending()
          .find((p) => p.path === path && p.method === 'POST');
        if (queued) return c.retry(queued.id);
        await c.refresh();
        const value = (type === 'target' ? c.data.targets : c.data.plans).find(
          (p: any) => p.id === id,
        );
        if (!value) throw new Error('这份目标已不存在，请查看最新资料。');
        if (value.status === 'active') return value;
        if (value.status !== 'draft')
          throw new Error('这份目标已停用，请查看详情。');
        if (value.version !== Number(version))
          throw new Error('草案已更新，请先查看详情再确认。');
        const time = await c.time();
        if (client() !== c || c.storageKey !== scope)
          throw new Error('本地数据已更换，请重新操作。');
        return c.mutate(path, {
          expected_version: value.version,
          apply_from: time.local_date,
        });
      },
      '已应用到今日',
    );
    if (
      result &&
      client() === c &&
      c.storageKey === scope &&
      getCurrentPages().at(-1)?.route !== 'pages/today/index'
    )
      wx.switchTab({ url: '/pages/today/index' });
    return result;
  },
};
