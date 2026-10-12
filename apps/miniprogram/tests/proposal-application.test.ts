import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalClient } from '../src/local/client';
import { platformStore } from './local-fixtures';
import { chatView } from '../src/lib/view';

afterEach(() => vi.unstubAllGlobals());
const clock = () => new Date('2026-10-11T10:00:00Z');
const nutrition = {
  effective_from: '2026-11-01',
  effective_to: '2026-11-28',
  water_ml: 2500,
  calories_kcal: 2000,
  carbs_g: 220,
  protein_g: 120,
  fat_g: 65,
};
const exercise = {
  exercise_id: 'squat',
  name: '深蹲',
  variant: '徒手',
  equipment: '徒手',
  load_convention: 'bodyweight',
  sets: 3,
  reps_min: 8,
  reps_max: 12,
  weight_kg: null,
  increment_kg: null,
  rest_seconds: 60,
};
async function setup(at = clock) {
  const c = new LocalClient(platformStore(), at);
  await c.refresh();
  const target = await c.mutate('/targets/drafts', nutrition);
  const plan = await c.mutate('/plans/drafts', {
    name: '每周力量训练',
    weekly: {
      start_date: '2026-11-01',
      end_date: '2026-11-28',
      days: [{ weekday: 4, name: '全身力量', exercises: [exercise] }],
    },
  });
  await c.refresh();
  const proposals = [
    { ...target, type: 'target' },
    { ...plan, type: 'plan' },
  ];
  const message: any = {
    message_id: 'fixture-message',
    text: '帮我制定目标',
    status: 'completed',
    created_at: clock().toISOString(),
    result: {
      message_id: 'fixture-message',
      assistant_text: '已生成饮食和运动目标，请确认。',
      proposals,
      record_receipts: [],
      tool_errors: [],
    },
  };
  vi.stubGlobal('getApp', () => ({ client: c }));
  vi.stubGlobal('getCurrentPages', () => [{ route: 'pages/today/index' }]);
  vi.stubGlobal('wx', {
    showToast: vi.fn(),
    navigateTo: vi.fn(),
    switchTab: vi.fn(),
  });
  return { c, target, plan, message };
}
function screen(c: LocalClient) {
  return {
    data: { busy: false, error: '', pending: [] },
    setData(value: any) {
      Object.assign(this.data, value);
    },
    async load() {
      await c.refresh();
    },
  };
}
const event = (type: string, value: any) => ({
  currentTarget: { dataset: { type, id: value.id, version: value.version } },
});

describe('proposal card projection', () => {
  it('clearly labels dietary and exercise goals and projects live confirmation state', async () => {
    const { c, target, message } = await setup();
    let cards = chatView([message], c.data)[0].proposals;
    expect(cards.map((p) => p.category)).toEqual(['饮食目标', '运动目标']);
    expect(cards.every((p) => p.canConfirm)).toBe(true);
    await c.mutate('/targets/' + target.id + '/confirm', {
      expected_version: target.version,
      apply_from: '2026-10-11',
    });
    await c.refresh();
    cards = chatView([message], c.data)[0].proposals;
    expect(cards[0].statusLabel).toBe('已应用');
    expect(cards[0].canConfirm).toBe(false);
    expect(cards[0].preview).toContain('2000');
    expect(cards[1].canConfirm).toBe(true);
  });
  it('does not let a stale card confirm revised prescriptions the user has not viewed', async () => {
    const { c, plan, message } = await setup();
    await c.mutate(
      '/plans/' + plan.id,
      { expected_version: plan.version, patch: { name: '修订后的计划' } },
      'PATCH',
    );
    await c.refresh();
    expect(chatView([message], c.data)[0].proposals[1].canConfirm).toBe(false);
  });
});

describe('direct proposal application', () => {
  it('applies the dietary budget from device today and immediately refreshes remaining allowances', async () => {
    const { c, target } = await setup();
    await c.mutate('/records', { kind: 'water', amount_ml: 300 });
    const { proposalActions } = await import('../src/lib/proposal-actions');
    const p = screen(c);
    await proposalActions.confirmProposal.call(p, event('target', target));
    expect(p.data.error).toBe('');
    expect(c.data.summary.water_ml.target).toBe(2500);
    expect(c.data.summary.water_ml.remaining).toBe(2200);
    expect(c.data.summary.calories_kcal.target).toBe(2000);
    expect(c.data.targets[0].effective_from).toBe('2026-10-11');
    expect(c.data.targets[0].effective_to).toBe('2026-11-07');
  });
  it('enables the exercise goal today while preserving the Thursday schedule', async () => {
    const { c, plan } = await setup();
    const { proposalActions } = await import('../src/lib/proposal-actions');
    const p = screen(c);
    await proposalActions.confirmProposal.call(p, event('plan', plan));
    expect(p.data.error).toBe('');
    expect(c.data.plans[0].status).toBe('active');
    expect(c.data.plans[0].period.start_date).toBe('2026-10-11');
    expect(
      c.data.days
        .filter((d: any) => d.status === 'active')
        .map((d: any) => d.local_date)
        .sort(),
    ).toEqual(['2026-10-15', '2026-10-22', '2026-10-29', '2026-11-05']);
  });
  it('rejects revised cards and leaves the plan as a draft', async () => {
    const { c, plan } = await setup();
    await c.mutate(
      '/plans/' + plan.id,
      { expected_version: plan.version, patch: { name: '已修改' } },
      'PATCH',
    );
    const { proposalActions } = await import('../src/lib/proposal-actions');
    const p = screen(c);
    await proposalActions.confirmProposal.call(p, event('plan', plan));
    expect(p.data.error).toContain('查看详情');
    await c.refresh();
    expect(c.data.plans[0].status).toBe('draft');
  });
  it('routes a successful confirmation from the chat screen directly to Today', async () => {
    const { c, target } = await setup();
    vi.stubGlobal('getCurrentPages', () => [{ route: 'pages/chat/index' }]);
    const { proposalActions } = await import('../src/lib/proposal-actions');
    await proposalActions.confirmProposal.call(
      screen(c),
      event('target', target),
    );
    expect(wx.switchTab).toHaveBeenCalledWith({ url: '/pages/today/index' });
  });
  it('ignores repeated taps while applying and never activates an already applied card again', async () => {
    const { c, target } = await setup();
    const { proposalActions } = await import('../src/lib/proposal-actions');
    const p = screen(c);
    await Promise.all([
      proposalActions.confirmProposal.call(p, event('target', target)),
      proposalActions.confirmProposal.call(p, event('target', target)),
    ]);
    const confirmedVersion = c.data.targets[0].version;
    await proposalActions.confirmProposal.call(p, event('target', target));
    expect(c.data.targets[0].version).toBe(confirmedVersion);
    expect(
      c.data.targets.filter((t: any) => t.status === 'active'),
    ).toHaveLength(1);
    expect(c.pending()).toEqual([]);
  });
  it('does not apply an old proposal when the local data scope changes during the time lookup', async () => {
    const { c, target } = await setup();
    const { proposalActions } = await import('../src/lib/proposal-actions');
    const originalTime = c.time.bind(c);
    let calls = 0;
    const lookup = vi.spyOn(c, 'time').mockImplementation(async () => {
      const captured = await originalTime();
      // refresh checks time twice; replace data during the explicit click-date lookup.
      if (++calls === 3) {
        lookup.mockRestore();
        await c.clearLocalData();
      }
      return captured;
    });
    const p = screen(c);
    await proposalActions.confirmProposal.call(p, event('target', target));
    expect(c.core.services.targets.list('personal')).toEqual([]);
    expect(c.pending()).toEqual([]);
    expect(wx.switchTab).not.toHaveBeenCalled();
  });
  it('reuses the captured date when a confirmation is retried after midnight', async () => {
    let now = new Date('2026-10-11T15:59:00Z');
    const { c, target } = await setup(() => now);
    c.save('pending', [
      {
        id: 'failed-confirm',
        path: '/targets/' + target.id + '/confirm',
        method: 'POST',
        body: { expected_version: target.version, apply_from: '2026-10-11' },
        created_at: now.toISOString(),
      },
    ]);
    now = new Date('2026-10-11T16:01:00Z');
    const { proposalActions } = await import('../src/lib/proposal-actions');
    await proposalActions.confirmProposal.call(
      screen(c),
      event('target', target),
    );
    expect(c.data.targets[0].effective_from).toBe('2026-10-11');
    expect(c.pending()).toEqual([]);
  });
});

describe('Today applied goals', () => {
  it('shows the active exercise goal and next workout on a rest day, and never treats drafts as Today training', async () => {
    const { c, plan } = await setup();
    vi.resetModules();
    let definition: any;
    vi.stubGlobal('Page', (p: any) => {
      definition = p;
    });
    await import('../src/pages/today/index');
    const p: any = {
      ...definition,
      data: structuredClone(definition.data),
      setData(value: any) {
        Object.assign(this.data, value);
      },
    };
    await p.load();
    expect(p.data.day).toBeNull();
    expect(p.data.trainingGoal).toBeNull();
    const { proposalActions } = await import('../src/lib/proposal-actions');
    await proposalActions.confirmProposal.call(p, event('plan', plan));
    expect(p.data.trainingGoal.id).toBe(plan.id);
    expect(p.data.day).toBeNull();
    expect(p.data.nextTraining.local_date).toBe('2026-10-15');
  });
});
