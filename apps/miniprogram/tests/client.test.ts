import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../../api/src/app';
import { MiniClient, MiniError } from '../src/lib/client';
import { budgetView, labelRecord, planView, chatView } from '../src/lib/view';

function bridge(handler: (o: any) => any) {
  const storage = new Map<string, any>();
  return {
    getStorageSync: (k: string) => structuredClone(storage.get(k)),
    setStorageSync: (k: string, v: any) => storage.set(k, structuredClone(v)),
    removeStorageSync: (k: string) => storage.delete(k),
    request: (o: any) => {
      Promise.resolve()
        .then(() => handler(o))
        .then(o.success, o.fail);
      return {};
    },
    uploadFile: () => ({}),
  };
}
const envelope = (data: any) => ({
  statusCode: 200,
  data: {
    data,
    server_time: '2026-10-11T10:00:00Z',
    timezone: 'Asia/Shanghai',
    request_id: 'test',
  },
});
const context = {
  now_utc: '2026-10-11T10:00:00Z',
  local_date: '2026-10-11',
  timezone: 'Asia/Shanghai',
};

describe('WeChat client boundary', () => {
  it('restores a retried transcription to the draft exactly once', async () => {
    let lose = true;
    const c = new MiniClient(
      bridge((o) => {
        if (o.url.endsWith('/context')) return envelope(context);
        if (lose) {
          lose = false;
          throw new Error('lost response');
        }
        return envelope({ text: '刚喝了300毫升水' });
      }),
    );
    await c.connect({ base_url: 'https://fit.test', token: 't' });
    c.save('draft', '已有文字');
    await expect(
      c.mutate('/audio/transcriptions', { asset_id: 'audio-1' }),
    ).rejects.toThrow();
    const id = c.pending()[0].id;
    await c.retry(id);
    expect(c.saved('draft', '')).toBe('已有文字\n刚喝了300毫升水');
    await expect(c.retry(id)).rejects.toThrow();
    expect(c.saved('draft', '')).toBe('已有文字\n刚喝了300毫升水');
  });
  it('treats WeChat empty-string storage responses as an empty pending list', async () => {
    const p = bridge(() => envelope(context));
    const get = p.getStorageSync;
    p.getStorageSync = (k) => get(k) ?? '';
    const c = new MiniClient(p);
    await c.connect({ base_url: 'https://fit.test', token: 't' });
    expect(c.pending()).toEqual([]);
  });
  it('rejects unauthorized connection and does not persist credentials', async () => {
    const p = bridge(() => ({
      statusCode: 401,
      data: { error: { code: 'UNAUTHORIZED', message: '请输入个人访问令牌' } },
    }));
    const c = new MiniClient(p);
    await expect(
      c.connect({ base_url: 'http://192.168.8.22:8787', token: 'bad' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(c.connected).toBe(false);
  });
  it('rejects loopback address on phone with a useful error', async () => {
    const c = new MiniClient(bridge(() => envelope(context)));
    await expect(
      c.connect({ base_url: 'http://127.0.0.1:8787', token: 't' }),
    ).rejects.toThrow('电脑的局域网');
  });
  it('rejects successful HTTP responses lacking a FitMind envelope', async () => {
    const c = new MiniClient(
      bridge(() => ({ statusCode: 200, data: '<html>proxy</html>' })),
    );
    await expect(
      c.connect({ base_url: 'https://fit.test', token: 't' }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('retries a lost response without duplicating water in the real API', async () => {
    const db = new DatabaseSync(':memory:');
    const app = await createApp({
      db,
      clock: () => new Date(context.now_utc),
      access_token: 'personal-token',
      media_root: 'data/test-media',
    });
    let lose = true;
    const p = bridge(async (o) => {
      const r = await app.inject({
        method: o.method,
        url: new URL(o.url).pathname,
        headers: o.header,
        payload: o.data,
      });
      if (o.method === 'POST' && lose) {
        lose = false;
        throw new Error('connection closed');
      }
      return { statusCode: r.statusCode, data: r.json() };
    });
    try {
      const c = new MiniClient(p);
      await c.connect({
        base_url: 'https://fit.test',
        token: 'personal-token',
      });
      await expect(
        c.mutate('/records', {
          kind: 'water',
          amount_ml: 250,
          local_date: context.local_date,
        }),
      ).rejects.toBeInstanceOf(MiniError);
      expect(c.pending()).toHaveLength(1);
      const restored = new MiniClient(p);
      await restored.retry(restored.pending()[0].id);
      expect(restored.pending()).toHaveLength(0);
      const records = await restored.request('GET', '/records');
      expect(records.items).toHaveLength(1);
      expect(records.items[0].amount_ml).toBe(250);
    } finally {
      await app.close();
      db.close();
    }
  });
  it('keeps failed chat message ID and capture metadata on retry', async () => {
    const bodies: any[] = [];
    let lose = true;
    const p = bridge((o) => {
      if (o.url.endsWith('/context')) return envelope(context);
      bodies.push(o.data);
      if (lose) {
        lose = false;
        throw new Error('timeout');
      }
      return envelope({
        status: 'completed',
        message_id: o.data.message_id,
        assistant_text: '已记录',
      });
    });
    const c = new MiniClient(p);
    await c.connect({ base_url: 'https://fit.test', token: 't' });
    await expect(c.sendChat('喝了250毫升水')).rejects.toThrow();
    await c.retry(c.pending()[0].id);
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[0].capture_local_date).toBe('2026-10-11');
    expect(bodies[0].capture_timezone).toBe('Asia/Shanghai');
  });
  it('isolates pending commands when switching the server', async () => {
    const p = bridge((o) =>
      o.url.endsWith('/context')
        ? envelope(context)
        : Promise.reject(new Error('offline')),
    );
    const c = new MiniClient(p);
    await c.connect({ base_url: 'https://a.test', token: 't' });
    await expect(
      c.mutate('/records', { kind: 'water', amount_ml: 250 }),
    ).rejects.toThrow();
    await c.connect({ base_url: 'https://b.test', token: 'other' });
    expect(c.pending()).toHaveLength(0);
    expect(c.data.summary).toBeNull();
  });
  it('refetches the summary if the server date changes during refresh', async () => {
    let contextCalls = 0;
    const p = bridge((o) => {
      if (o.url.endsWith('/context'))
        return envelope({
          ...context,
          local_date: ++contextCalls > 2 ? '2026-10-12' : '2026-10-11',
        });
      if (o.url.includes('/summary'))
        return envelope({
          local_date: o.url.includes('2026-10-12')
            ? '2026-10-12'
            : '2026-10-11',
        });
      if (o.url.includes('/records?')) return envelope({ items: [] });
      if (o.url.endsWith('/profile'))
        return envelope({ timezone: 'Asia/Shanghai' });
      return envelope([]);
    });
    const c = new MiniClient(p);
    await c.connect({ base_url: 'https://fit.test', token: 't' });
    await c.refresh();
    expect(c.data.context.local_date).toBe('2026-10-12');
    expect(c.data.summary.local_date).toBe('2026-10-12');
  });
});

describe('mobile view models', () => {
  it('shows unknown and exceeded budgets separately', () => {
    expect(
      budgetView('water_ml', {
        target: null,
        known_total: 500,
        remaining: null,
        over: null,
      }),
    ).toMatchObject({ value: '—', label: '待设目标' });
    expect(
      budgetView('water_ml', {
        target: 2000,
        known_total: 2200,
        remaining: 0,
        over: 200,
      }),
    ).toMatchObject({ value: '200', label: '已超出', unit: 'ml' });
  });
  it('scales a label while preserving unknown fat', () => {
    const r = labelRecord(
      {
        name: '豆奶',
        basis: '100',
        consumed: '250',
        unit: 'ml',
        calories: '46',
        carbs: '4',
        protein: '3',
        fat: '',
      },
      '2026-10-11',
    );
    expect(r.nutrition).toEqual({
      calories_kcal: 115,
      carbs_g: 10,
      protein_g: 7.5,
      fat_g: null,
    });
    expect(r.label.nutrition_per_basis.fat_g).toBeNull();
    expect(r.local_date).toBe('2026-10-11');
  });
  it('rejects invalid quantities instead of storing NaN or zero', () => {
    expect(() =>
      labelRecord(
        {
          name: '牛奶',
          basis: '0',
          consumed: '200',
          unit: 'ml',
          calories: '50',
        },
        '2026-10-11',
      ),
    ).toThrow();
    expect(() =>
      labelRecord(
        {
          name: '牛奶',
          basis: '100',
          consumed: '200',
          unit: 'ml',
          calories: 'abc',
        },
        '2026-10-11',
      ),
    ).toThrow();
  });
  it('removes reasoning from chat and preserves a short readable answer', () => {
    expect(
      chatView([
        {
          message_id: 'm',
          text: '今天怎么练',
          result: {
            assistant_text: '<think>private reasoning</think>今天练胸和肩。',
            record_receipts: [],
          },
        },
      ])[0].answer,
    ).toBe('今天练胸和肩。');
  });
  it('conversation shows actionable target drafts and concrete saved receipts', () => {
    const message = chatView([
      {
        message_id: 'm',
        result: {
          assistant_text: '请确认目标。',
          proposals: [
            {
              id: 't',
              type: 'target',
              effective_from: '2026-10-11',
              calories_kcal: 2100,
            },
          ],
          record_receipts: [
            {
              entity: {
                kind: 'water',
                amount_ml: 300,
                local_date: '2026-10-11',
              },
            },
          ],
        },
      },
    ])[0];
    expect(message.proposals[0]).toMatchObject({
      id: 't',
      title: '每日营养与饮水',
      category: '饮食目标',
      timingHint: '确认后从今日起使用这些每日额度。',
    });
    expect(message.proposals[0].preview).toContain('热量 2100 kcal');
    expect(message.receipts[0].label).toBe('已保存 · 300 毫升水 · 2026-10-11');
  });
  it('shows identical weeks as one template, keeping a one-off prescription change', () => {
    const exercise = {
      exercise_id: 'e',
      name: '卧推',
      variant: '',
      equipment: 'barbell',
      load_convention: 'total',
      weight_kg: 30,
      increment_kg: 2.5,
      sets: 3,
      reps_min: 8,
      reps_max: 12,
      rest_seconds: 90,
    };
    const days = ['2026-10-14', '2026-10-21', '2026-10-28'].map((d, i) => ({
      id: String(i),
      name: '推',
      local_date: d,
      exercises: [
        { ...exercise, exercise_id: String(i), weight_kg: i === 2 ? 32.5 : 30 },
      ],
    }));
    const v = planView({
      id: 'p',
      name: '八周计划',
      status: 'draft',
      version: 1,
      days,
    } as any);
    expect(v.blocks).toHaveLength(2);
    expect(v.blocks[0].label).toBe('每周三');
    expect(v.blocks[1].label).toBe('10月28日');
    expect(v.statusLabel).toBe('待确认');
  });
});
