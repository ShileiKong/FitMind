import { expect, it } from 'vitest';
import { Utf8TextEncoder } from '../src/local/runtime';
it('encodes Chinese, emoji, and isolated UTF-16 surrogates correctly without browser globals', () => {
  const encoder = new Utf8TextEncoder();
  for (const text of [
    '',
    'FitMind',
    '饮水300毫升',
    '🏋️💧',
    '\ud800',
    '\udc00',
    '\ud800A',
    '中\ud800文',
  ])
    expect([...encoder.encode(text)]).toEqual([...Buffer.from(text, 'utf8')]);
});
