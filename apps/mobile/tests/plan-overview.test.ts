import { beforeEach, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const state = vi.hoisted(() => ({
  app: {
    plans: [] as any[],
    credentials: {},
    context: { local_date: '2026-10-11' },
  },
}));
vi.mock('../src/state/app', () => ({ useApp: () => state.app }));
vi.mock('../src/state/use-submission', () => ({ useSubmission: () => ({}) }));
vi.mock('expo-router', () => ({ router: { push: vi.fn() } }));
vi.mock('react-native', () => ({
  View: 'div',
  Text: 'span',
  Platform: { OS: 'web' },
  StyleSheet: { create: (s: any) => s },
}));
vi.mock('../src/components/ui', () => ({
  Screen: 'main',
  Card: 'section',
  Heading: ({ title }: any) => React.createElement('h1', null, title),
  Button: ({ title }: any) => React.createElement('button', null, title),
}));
vi.mock('../src/components/PlanEditor', () => ({ PlanEditor: () => null }));
vi.mock('lucide-react-native', () => ({ CalendarDays: () => null }));
import Plans from '../src/app/(tabs)/plans';
import { PlanSchedule } from '../src/components/PlanSchedule';
import { planOverview } from '@fitmind/contracts/plan-overview';

function fixture() {
  const days = [];
  for (let week = 0; week < 8; week++)
    for (let i = 0; i < 3; i++) {
      const date = new Date(
        Date.parse('2026-10-15') + (week * 7 + i) * 86400000,
      )
        .toISOString()
        .slice(0, 10);
      days.push({
        id: date,
        plan_id: 'p',
        plan_version: 1,
        status: 'draft',
        local_date: date,
        name: ['推', '拉', '腿'][i],
        exercises: [
          {
            exercise_id: date,
            name: ['卧推', '划船', '深蹲'][i],
            variant: '标准',
            equipment: 'barbell',
            load_convention: 'total',
            weight_kg: 30,
            increment_kg: 2.5,
            sets: 3,
            reps_min: 8,
            reps_max: 12,
            rest_seconds: 90,
          },
        ],
      });
    }
  return {
    id: 'p',
    version: 1,
    name: '两个月三分化',
    status: 'draft',
    days,
    created_at: '2026-10-11T02:00:00Z',
  };
}
beforeEach(() => {
  state.app.plans = [fixture()];
});
const render = () => renderToStaticMarkup(React.createElement(Plans));
it('summarizes an existing eight week daily plan as three weekday arrangements', () => {
  const html = render();
  expect(html).toContain('每周四 · 推');
  expect(html).toContain('每周五 · 拉');
  expect(html).toContain('每周六 · 腿');
  expect(html).toContain('2026年10月15日');
  expect(html).toContain('12月5日');
  expect(html).not.toContain('2026-11-19');
  expect(html.match(/每周四/g)?.length).toBe(1);
});
it('shows distinct date ranges instead of pretending a missing week still has training', () => {
  state.app.plans[0].days = state.app.plans[0].days.filter(
    (d: any) => d.local_date !== '2026-11-05',
  );
  const html = render();
  expect(html.match(/每周四/g)?.length).toBe(2);
  expect(html).toContain('10月29日');
  expect(html).toContain('11月12日');
});
it('keeps a changed weight separate from the surrounding repeated weeks', () => {
  const changed = state.app.plans[0].days.find(
    (d: any) => d.local_date === '2026-10-29',
  );
  changed.exercises[0].weight_kg = 40;
  const html = render();
  expect(html).toContain('1 个单独安排');
  expect(html.match(/每周四/g)?.length).toBe(2);
});
it('plan details show each repeated exercise once and keep the actual calendar behind a control', () => {
  const html = renderToStaticMarkup(
    React.createElement(PlanSchedule, { plan: state.app.plans[0] }),
  );
  expect(html.match(/卧推/g)?.length).toBe(1);
  expect(html.match(/划船/g)?.length).toBe(1);
  expect(html.match(/深蹲/g)?.length).toBe(1);
  expect(html).toContain('每周四');
  expect(html).toContain('按日期查看');
  expect(html).not.toContain('11月19日');
});
it('a one-off prescription is fully visible beside the repeating schedule', () => {
  state.app.plans[0].days[6].exercises[0].weight_kg = 40;
  const html = renderToStaticMarkup(
    React.createElement(PlanSchedule, { plan: state.app.plans[0] }),
  );
  expect(html).toContain('40 公斤');
  expect(html).toContain('2026年10月29日');
  expect(html).toContain('1 个单独安排');
});
it('next training uses the server local date instead of choosing an old template date', () => {
  const plan = state.app.plans[0];
  plan.status = 'active';
  plan.days.forEach((d: any) => {
    d.status = 'active';
  });
  const html = renderToStaticMarkup(
    React.createElement(PlanSchedule, { plan, today: '2026-11-18' }),
  );
  expect(html).toContain('查看下一次训练 · 11月19日');
});
it('a cross-year cycle keeps both years in its range', () => {
  const p = state.app.plans[0];
  p.period = { start_date: '2026-12-28', end_date: '2027-01-10' };
  p.days = [
    { ...p.days[0], id: 'a', local_date: '2026-12-31' },
    { ...p.days[0], id: 'b', local_date: '2027-01-07' },
  ];
  const html = renderToStaticMarkup(
    React.createElement(PlanSchedule, { plan: p }),
  );
  expect(html).toContain('2026年12月28日 — 2027年1月10日');
  expect(html.match(/卧推/g)?.length).toBe(1);
});
it.each(['sets', 'reps_min', 'rest_seconds', 'load_convention'])(
  'does not merge a %s change into identical surrounding weeks',
  (field) => {
    const p = state.app.plans[0];
    const changed = p.days[6].exercises[0];
    changed[field] =
      field === 'load_convention' ? 'per_hand' : changed[field] + 1;
    const summary = planOverview(p);
    expect(summary.single.map((d) => d.local_date)).toEqual(['2026-10-29']);
    expect(summary.total).toBe(24);
    expect(
      summary.weekly
        .filter((b) => b.weekday === 4)
        .map((b) => [b.start_date, b.end_date]),
    ).toEqual([
      ['2026-10-15', '2026-10-22'],
      ['2026-11-05', '2026-12-03'],
    ]);
  },
);
