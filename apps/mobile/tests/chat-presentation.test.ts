import { beforeEach, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const state = vi.hoisted(() => ({ app: { messages: [] as any[] } }));
vi.mock('../src/state/app', () => ({ useApp: () => state.app }));
vi.mock('expo-router', () => ({ router: { push: vi.fn() } }));
vi.mock('react-native', () => ({
  View: 'div',
  Text: 'span',
  Platform: { OS: 'web' },
  StyleSheet: { create: (s: any) => s },
}));
vi.mock('../src/components/ui', () => ({
  Button: ({ title }: any) => React.createElement('button', null, title),
}));
import { MessageList } from '../src/components/MessageList';

function message(result: any) {
  return {
    message_id: 'm',
    text: '帮我记录',
    created_at: '2026-10-11T02:00:00Z',
    result: {
      status: 'completed',
      assistant_text: '已记录。',
      record_receipts: [],
      proposals: [],
      recommendations: [],
      affected_dates: [],
      summary: null,
      tool_errors: [],
      ...result,
    },
  };
}
function render(result: any) {
  state.app.messages = [message(result)];
  return renderToStaticMarkup(React.createElement(MessageList));
}
beforeEach(() => {
  state.app.messages = [];
});

it('keeps short results fully visible without a details button', () => {
  const html = render({
    assistant_text: '已记录 300 毫升，今天还差 1700 毫升。',
  });
  expect(html).toContain('已记录 300 毫升，今天还差 1700 毫升。');
  expect(html).not.toContain('展开详情');
});
it('collapses long historical replies and offers access to the full answer', () => {
  const html = render({
    assistant_text:
      '训练草案已生成，确认后生效。\n\n' +
      '详细动作说明。'.repeat(50) +
      '末尾完整内容',
  });
  expect(html).toContain('训练草案已生成，确认后生效。');
  expect(html).toContain('展开详情');
  expect(html).not.toContain('末尾完整内容');
});
it('never displays a tagged reasoning block in a historical answer', () => {
  const html = render({
    assistant_text: '<think>PRIVATE_THOUGHT_SENTINEL</think>已记录 300 毫升。',
  });
  expect(html).not.toContain('PRIVATE_THOUGHT_SENTINEL');
  expect(html).toContain('已记录 300 毫升。');
});
it('hides an unfinished reasoning block without hiding the preceding result', () => {
  const html = render({
    assistant_text: '已记录 300 毫升。<think>UNFINISHED_PRIVATE_THOUGHT',
  });
  expect(html).toContain('已记录 300 毫升。');
  expect(html).not.toContain('UNFINISHED_PRIVATE_THOUGHT');
});
it('keeps failures visible when a long reply is collapsed and removes repeated errors', () => {
  const html = render({
    assistant_text: '请核对草案。' + '详细说明。'.repeat(80),
    tool_errors: Array.from({ length: 3 }, () => ({
      code: 'AMBIGUOUS_PROPOSAL',
      message: '有多个草案，请明确要确认的草案',
    })),
  });
  expect(html).toMatch(/草案.*确认/);
  expect(html.match(/有多个草案/g)?.length).toBe(1);
  expect(html).toContain('点击确认');
  expect(html).not.toContain('AMBIGUOUS_PROPOSAL');
});
it('previews a long plan with its date range and number of training days', () => {
  const html = render({
    proposals: [
      {
        type: 'plan',
        id: 'plan',
        name: '力量训练',
        days: [
          { local_date: '2026-10-15', name: '推' },
          { local_date: '2026-10-16', name: '拉' },
          { local_date: '2026-10-17', name: 'HIDDEN_DAY_DETAIL' },
        ],
      },
    ],
  });
  expect(html).toContain('待确认');
  expect(html).toContain('3 个训练日');
  expect(html).toContain('2026-10-15 至 2026-10-17');
  expect(html).not.toContain('HIDDEN_DAY_DETAIL');
  expect(html).toContain('查看草案');
});
it('does not describe a draft target as already effective', () => {
  const html = render({
    proposals: [
      {
        type: 'target',
        id: 't',
        effective_from: '2026-10-12',
        calories_kcal: 2100,
      },
    ],
  });
  expect(html).toContain('2100 千卡');
  expect(html).toContain('确认后生效');
});
it('labels saved body measurements with human readable units', () => {
  const html = render({
    record_receipts: [
      {
        entity: {
          kind: 'body',
          metric: 'weight_kg',
          value: 72,
          local_date: '2026-10-11',
        },
      },
    ],
  });
  expect(html).toContain('体重 72 公斤');
  expect(html).not.toContain('weight_kg');
});
it('does not describe an undone receipt as a saved intake', () => {
  const html = render({
    record_receipts: [
      {
        entity: {
          kind: 'water',
          amount_ml: 300,
          undone_at: '2026-10-11T02:00:00Z',
        },
      },
    ],
  });
  expect(html).toContain('已撤销');
  expect(html).not.toContain('已保存');
});
it('keeps unknown calories distinct from zero in a food receipt', () => {
  const html = render({
    record_receipts: [
      {
        entity: {
          kind: 'food',
          name: '早餐',
          source: 'estimate',
          nutrition: { calories_kcal: null },
        },
      },
    ],
  });
  expect(html).toContain('热量待补充');
  expect(html).toContain('估算');
  expect(html).not.toContain('0 千卡');
});
it('preserves zero actual reps and an unknown weight in a training receipt', () => {
  const html = render({ record_receipts: [{ reps: 0, weight_kg: null }] });
  expect(html).toContain('重量未填写');
  expect(html).toContain('0 次');
  expect(html).not.toContain('0 公斤');
});
