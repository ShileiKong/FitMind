import { describe, expect, it, vi } from 'vitest';
import { LocalClient } from '../src/local/client';

function phone() {
  const storage = new Map<string, any>();
  const platform = {
    getStorageSync: (key: string) => structuredClone(storage.get(key)),
    setStorageSync: (key: string, value: any) =>
      storage.set(key, structuredClone(value)),
    removeStorageSync: (key: string) => storage.delete(key),
    request: vi.fn(() => {
      throw new Error('Unexpected network');
    }),
  };
  return { platform, storage };
}
const at = () => new Date('2026-10-11T10:00:00Z');
describe('phone local client', () => {
  it('opens without credentials, records and restores data without any network', async () => {
    const { platform } = phone();
    const c = new LocalClient(platform, at);
    expect(c.connected).toBe(true);
    await c.refresh();
    expect(c.data.context.local_date).toBe('2026-10-11');
    await c.mutate('/records', { kind: 'water', amount_ml: 300 });
    const restarted = new LocalClient(platform, at);
    await restarted.refresh();
    expect(restarted.data.summary.water_ml.known_total).toBe(300);
    expect(restarted.pending()).toHaveLength(0);
    expect(platform.request).not.toHaveBeenCalled();
  });
  it('keeps local data independent of old computer connection and credentials', async () => {
    const { platform, storage } = phone();
    storage.set('fitmind.credentials', {
      base_url: 'http://192.168.8.22:8787',
      token: 'old-private-token',
    });
    const c = new LocalClient(platform, at);
    expect(c.settings).toBeNull();
    await c.refresh();
    expect(platform.request).not.toHaveBeenCalled();
    expect(storage.get('fitmind.credentials').token).toBe('old-private-token');
  });
  it('uses device time on every refresh and preserves yesterday separately after midnight', async () => {
    const { platform } = phone();
    let now = new Date('2026-10-11T15:59:00Z');
    const c = new LocalClient(platform, () => now);
    await c.mutate('/records', { kind: 'water', amount_ml: 500 });
    now = new Date('2026-10-11T16:01:00Z');
    await c.refresh();
    expect(c.data.context.local_date).toBe('2026-10-12');
    expect(c.data.summary.water_ml.known_total).toBe(0);
    const yesterday = await c.request('GET', '/days/2026-10-11/summary');
    expect(yesterday.water_ml.known_total).toBe(500);
  });
  it('saves chat to local history with a receipt using rules when no API key is set', async () => {
    const { platform } = phone();
    const c = new LocalClient(platform, at);
    c.save('draft', '喝了300毫升水');
    const r = await c.sendChat('喝了300毫升水');
    expect(r.status).toBe('completed');
    expect(r.record_receipts).toHaveLength(1);
    await c.refresh();
    expect(c.data.messages).toHaveLength(1);
    expect(c.data.summary.water_ml.known_total).toBe(300);
    expect(c.saved('draft', '')).toBe('');
    expect(platform.request).not.toHaveBeenCalled();
  });
  it('excludes model credentials from backup and clears obsolete queued commands after import', async () => {
    const { platform } = phone();
    const c = new LocalClient(platform, at);
    c.agent.saveModel({
      api_key: 'test-personal-model-key',
      model: 'deepseek-flash',
    });
    await c.mutate('/records', { kind: 'water', amount_ml: 200 });
    const backup = c.exportBackup();
    expect(backup).not.toContain('test-personal-model-key');
    await c.mutate('/records', { kind: 'water', amount_ml: 400 });
    c.save('pending', [
      {
        id: 'obsolete',
        method: 'POST',
        path: '/records',
        body: { kind: 'water', amount_ml: 900 },
      },
    ]);
    c.save('draft', 'old draft');
    await c.importBackup(backup);
    expect(c.pending()).toHaveLength(0);
    expect(c.saved('draft', '')).toBe('');
    expect(c.data.summary.water_ml.known_total).toBe(200);
    expect(c.agent.modelSettings.api_key).toBe('test-personal-model-key');
  });
  it('provides an in-app tomorrow reminder after the configured evening time', async () => {
    const { platform } = phone();
    const c = new LocalClient(platform, () => new Date('2026-10-11T13:05:00Z'));
    const p = await c.mutate('/plans/drafts', {
      name: '明日训练',
      days: [
        {
          local_date: '2026-10-12',
          name: '推',
          exercises: [
            {
              exercise_id: 'bench',
              name: '卧推',
              variant: '平板',
              equipment: '杠铃',
              load_convention: 'total',
              sets: 3,
              reps_min: 8,
              reps_max: 12,
              weight_kg: 30,
              increment_kg: 2.5,
              rest_seconds: 90,
            },
          ],
        },
      ],
    });
    await c.mutate('/plans/' + p.id + '/confirm', {
      expected_version: p.version,
    });
    await c.refresh();
    expect(c.reminder?.name).toBe('推');
    expect(c.reminder?.local_date).toBe('2026-10-12');
    expect(platform.request).not.toHaveBeenCalled();
  });
  it('does not import midway through a refresh and mix old balances with new data', async () => {
    const { platform } = phone();
    const c = new LocalClient(platform, at),
      blank = c.exportBackup();
    await c.mutate('/records', { kind: 'water', amount_ml: 300 });
    const running = c.refresh();
    for (let i = 0; i < 9; i++) await Promise.resolve();
    await expect(c.importBackup(blank)).rejects.toThrow('有操作正在处理');
    await running;
    await c.importBackup(blank);
    expect(c.data.summary.water_ml.known_total).toBe(0);
    expect(
      (await c.request('GET', '/days/2026-10-11/summary')).water_ml.known_total,
    ).toBe(0);
  });
  it('an actual workout page resets its old session binding when backup import changes data scope', async () => {
    vi.resetModules();
    const { platform } = phone();
    const c = new LocalClient(platform, at),
      blank = c.exportBackup();
    const p = await c.mutate('/plans/drafts', {
      name: '推',
      days: [
        {
          local_date: '2026-10-11',
          name: '推',
          exercises: [
            {
              exercise_id: 'bench',
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
            },
          ],
        },
      ],
    });
    const confirmed = await c.mutate('/plans/' + p.id + '/confirm', {
      expected_version: p.version,
    });
    const session = await c.mutate('/workout-sessions', {
      workout_day_id: confirmed.days[0].id,
    });
    let definition: any;
    vi.stubGlobal('getApp', () => ({ client: c }));
    vi.stubGlobal('Page', (value: any) => {
      definition = value;
    });
    vi.stubGlobal('wx', {});
    try {
      await import('../src/pages/workout/index');
      const page = {
        ...definition,
        data: structuredClone(definition.data),
        setData(values: any) {
          Object.assign(this.data, values);
        },
      };
      page.onLoad({ id: session.id });
      await page.load();
      expect(page.data.session.id).toBe(session.id);
      await c.importBackup(blank);
      await page.load();
      expect(page.data.error).toBe('');
      expect(page.data.session).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
