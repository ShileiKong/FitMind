import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../../api/src/app';
import { MiniClient } from '../src/lib/client';

let app: any, db: DatabaseSync, c: MiniClient, definition: any;
let loseNext: boolean, now: string;
let holdPatch: { held: () => void; release?: () => void } | null;
const navigation: string[] = [];
const ex = {
  exercise_id: 'bench',
  name: '卧推',
  variant: '平板',
  equipment: '杠铃',
  load_convention: 'total',
  weight_kg: 30,
  increment_kg: 2.5,
  sets: 3,
  reps_min: 8,
  reps_max: 12,
  rest_seconds: 90,
};
beforeEach(async () => {
  vi.resetModules();
  now = '2026-10-11T10:00:00Z';
  loseNext = false;
  holdPatch = null;
  navigation.length = 0;
  db = new DatabaseSync(':memory:');
  app = await createApp({
    db,
    clock: () => new Date(now),
    access_token: 'test-token',
    media_root: 'data/test-media',
  });
  const store = new Map();
  c = new MiniClient({
    getStorageSync: (k: string) => structuredClone(store.get(k)),
    setStorageSync: (k: string, v: any) => store.set(k, structuredClone(v)),
    removeStorageSync: (k: string) => store.delete(k),
    request: (o: any) => {
      void app
        .inject({
          method: o.method,
          url: new URL(o.url).pathname + new URL(o.url).search,
          headers: o.header,
          payload: o.data,
        })
        .then((r: any) => {
          if (holdPatch && o.method === 'PATCH') {
            const gate = holdPatch;
            holdPatch = null;
            gate.release = () =>
              o.success({ statusCode: r.statusCode, data: r.json() });
            gate.held();
            return;
          }
          if (loseNext && o.method !== 'GET') {
            loseNext = false;
            o.fail({});
          } else o.success({ statusCode: r.statusCode, data: r.json() });
        });
    },
    uploadFile: () => {},
  });
  await c.connect({ base_url: 'https://fit.test', token: 'test-token' });
  vi.stubGlobal('getApp', () => ({ client: c }));
  vi.stubGlobal('getCurrentPages', () => [{ route: 'pages/plan-detail/index' }]);
  vi.stubGlobal('Page', (p: any) => {
    definition = p;
  });
  vi.stubGlobal('wx', {
    showToast: () => {},
    showModal: (o: any) => o.success({ confirm: true }),
    switchTab: (o: any) => navigation.push('tab:' + o.url),
    navigateTo: (o: any) => navigation.push(o.url),
  });
});
afterEach(async () => {
  await app.close();
  db.close();
  vi.unstubAllGlobals();
});
function page() {
  return {
    ...definition,
    data: structuredClone(definition.data),
    setData(values: any) {
      for (const [key, value] of Object.entries(values)) {
        const parts = key.split('.');
        let target: any = this.data;
        for (const part of parts.slice(0, -1))
          target = target[part] ?? (target[part] = {});
        target[parts.at(-1)!] = value;
      }
    },
  };
}
async function activePlan(dates = ['2026-10-11']) {
  const draft = await c.mutate('/plans/drafts', {
    name: '上肢计划',
    days: dates.map((date) => ({
      name: '推',
      local_date: date,
      exercises: [ex],
    })),
  });
  return c.mutate('/plans/' + draft.id + '/confirm', {
    expected_version: draft.version,
  });
}
const event = (id: string) => ({ currentTarget: { dataset: { id } } });

it('create plan opens an editable manual draft without sending the user to chat', async () => {
  await import('../src/pages/plans/index');
  const p = page();
  await p.load();
  await p.newPlan();
  expect(p.data.editing).toBe(true);
  expect(p.data.editorForm.days[0].local_date).toBe('2026-10-12');
  expect(navigation).toEqual([]);
});

it('manual draft saves real prescriptions and leaves blank planned weight unknown', async () => {
  await import('../src/pages/plans/index');
  const p = page();
  await p.load();
  await p.newPlan();
  expect(p.savePlan).toBeTypeOf('function');
  p.data.editorForm.name = '手工计划';
  Object.assign(p.data.editorForm.days[0].exercises[0], {
    name: '卧推',
    weight_kg: '',
    increment_kg: '',
  });
  await p.savePlan();
  const plans = await c.request('GET', '/plans');
  expect(plans).toHaveLength(1);
  expect(plans[0].status).toBe('draft');
  expect(plans[0].days[0].exercises[0]).toMatchObject({
    name: '卧推',
    weight_kg: null,
    increment_kg: null,
    sets: 3,
  });
  expect(navigation).toEqual(['/pages/plan-detail/index?id=' + plans[0].id]);
});

it('retrying a draft after a lost response creates one plan and preserves an edited unsaved form', async () => {
  await import('../src/pages/plans/index');
  const p = page();
  await p.load();
  await p.newPlan();
  expect(p.savePlan).toBeTypeOf('function');
  p.data.editorForm.name = '原计划';
  p.data.editorForm.days[0].exercises[0].name = '卧推';
  loseNext = true;
  await p.savePlan();
  expect(c.pending()).toHaveLength(1);
  p.data.editorForm.name = '还未保存的新计划';
  await p.retryInput({ detail: { id: c.pending()[0].id } });
  expect(await c.request('GET', '/plans')).toHaveLength(1);
  expect(p.data.editorForm.name).toBe('还未保存的新计划');
  expect(p.data.editing).toBe(true);
});

it('weekly schedule keeps three real dates behind the toggle and selects the next active day', async () => {
  const plan = await activePlan(['2026-10-12', '2026-10-19', '2026-10-26']);
  await import('../src/pages/plan-detail/index');
  const p = page();
  p.onLoad({ id: plan.id });
  await p.load();
  expect(p.data.plan.weekly).toHaveLength(1);
  expect(p.data.plan.weekly[0].count).toBe(3);
  expect(p.data.expanded).toBe(false);
  p.expand();
  expect(p.data.expanded).toBe(true);
  expect(p.data.plan.dates.map((d: any) => d.local_date)).toEqual([
    '2026-10-12',
    '2026-10-19',
    '2026-10-26',
  ]);
  p.training(event(plan.days[0].id));
  expect(navigation).toEqual(['/pages/day/index?id=' + plan.days[0].id]);
});

it('plan edits use the displayed version and preserve exercise identity', async () => {
  const plan = await activePlan();
  await import('../src/pages/plan-detail/index');
  const p = page();
  p.onLoad({ id: plan.id });
  await p.load();
  p.adjust();
  expect(p.data.editing).toBe(true);
  p.data.editorForm.days[0].local_date = '2026-10-13';
  p.data.editorForm.days[0].exercises[0].name = '杠铃卧推';
  await p.savePlan();
  const changed = await c.request('GET', '/plans/' + plan.id);
  expect(changed.version).toBe(plan.version + 1);
  expect(changed.days[0].local_date).toBe('2026-10-13');
  expect(changed.days[0].exercises[0].exercise_id).toBe('bench');
});

it('training history includes completed and active sessions with their actual totals', async () => {
  const plan = await activePlan(['2026-10-11', '2026-10-12']);
  const old = await c.mutate('/workout-sessions', {
    workout_day_id: plan.days[0].id,
  });
  const saved = await c.mutate('/workout-sessions/' + old.id + '/sets', {
    exercise_id: 'bench',
    weight_kg: null,
    reps: 10,
  });
  await c.mutate('/workout-sessions/' + old.id + '/transition', {
    expected_version: saved.session.version,
    action: 'complete',
  });
  const current = await c.mutate('/workout-sessions', {
    workout_day_id: plan.days[1].id,
  });
  await import('../src/pages/training/index');
  const p = page();
  await p.load();
  expect(p.data.sessions).toHaveLength(2);
  expect(p.data.sessions.find((s: any) => s.id === old.id)).toMatchObject({
    status: 'completed',
    setCount: 1,
    repCount: 10,
  });
  p.detail(event(old.id));
  p.detail(event(current.id));
  expect(navigation).toEqual([
    '/pages/workout/index?id=' + old.id,
    '/pages/workout/index?id=' + current.id,
  ]);
});

it('session id opens completed history even while a different session is active', async () => {
  const plan = await activePlan(['2026-10-11', '2026-10-12']);
  const old = await c.mutate('/workout-sessions', {
    workout_day_id: plan.days[0].id,
  });
  await c.mutate('/workout-sessions/' + old.id + '/transition', {
    expected_version: old.version,
    action: 'complete',
  });
  await c.mutate('/workout-sessions', { workout_day_id: plan.days[1].id });
  await import('../src/pages/workout/index');
  const p = page();
  p.onLoad?.({ id: old.id });
  await p.load();
  expect(p.data.session.id).toBe(old.id);
  expect(p.data.session.status).toBe('completed');
  expect(p.data.canRecord).toBe(false);
});

it('starting a selected future day preserves its snapshot and records the actual training date', async () => {
  const plan = await activePlan(['2026-10-13']);
  await import('../src/pages/day/index');
  const p = page();
  p.onLoad({ id: plan.days[0].id });
  await p.load();
  await p.start();
  const sessions = await c.request('GET', '/workout-sessions');
  expect(sessions).toHaveLength(1);
  expect(sessions[0].workout_day_id).toBe(plan.days[0].id);
  expect(sessions[0].snapshot.local_date).toBe('2026-10-13');
  expect(sessions[0].local_date).toBe('2026-10-11');
  expect(navigation).toEqual(['/pages/workout/index?id=' + sessions[0].id]);
});

it('actual weight starts blank and remains unknown when a user records only repetitions', async () => {
  const plan = await activePlan();
  await c.mutate('/workout-sessions', { workout_day_id: plan.days[0].id });
  await import('../src/pages/workout/index');
  const p = page();
  await p.load();
  expect(p.data.weight).toBe('');
  p.data.reps = '10';
  await p.recordSet();
  expect(p.data.sets[0].weight_kg).toBeNull();
});

it('lost actual set response retries the original occurrence time and saves one actual set', async () => {
  const plan = await activePlan();
  const session = await c.mutate('/workout-sessions', {
    workout_day_id: plan.days[0].id,
  });
  await import('../src/pages/workout/index');
  const p = page();
  await p.load();
  p.data.weight = '30';
  p.data.reps = '10';
  loseNext = true;
  await p.recordSet();
  expect(c.pending()).toHaveLength(1);
  now = '2026-10-11T10:02:00Z';
  await p.recordSet();
  expect(c.pending()).toHaveLength(0);
  expect(
    (await c.request('GET', '/workout-sessions/' + session.id)).sets,
  ).toHaveLength(1);
  expect(p.data.reps).toBe('');
});

it('a plan editor opened on an older version rejects overwriting changes made elsewhere', async () => {
  const plan = await activePlan();
  await import('../src/pages/plan-detail/index');
  const p = page();
  p.onLoad({ id: plan.id });
  await p.load();
  p.adjust();
  await c.mutate(
    '/plans/' + plan.id,
    { expected_version: plan.version, patch: { name: '已被教练调整' } },
    'PATCH',
  );
  await p.load();
  p.data.editorForm.name = '来自旧草稿的修改';
  await p.savePlan();
  expect((await c.request('GET', '/plans/' + plan.id)).name).toBe(
    '已被教练调整',
  );
  expect(p.data.error).not.toBe('');
  expect(p.data.editorForm.name).toBe('来自旧草稿的修改');
});

it('replayed plan patch advances the retained edited form version and permits its next save', async () => {
  const plan = await activePlan();
  await import('../src/pages/plan-detail/index');
  const p = page();
  p.onLoad({ id: plan.id });
  await p.load();
  p.adjust();
  p.data.editorForm.name = '第一次修改';
  loseNext = true;
  await p.savePlan();
  expect(c.pending()).toHaveLength(1);
  p.data.editorForm.name = '回执等待时继续修改';
  await p.retryInput({ detail: { id: c.pending()[0].id } });
  expect(p.data.editing).toBe(true);
  expect(p.data.editorForm.name).toBe('回执等待时继续修改');
  expect(p.data.editorVersion).toBe(plan.version + 1);
  const reopened = page();
  reopened.onLoad({ id: plan.id });
  await reopened.load();
  expect(reopened.data.editorForm.name).toBe('回执等待时继续修改');
  expect(reopened.data.editorVersion).toBe(plan.version + 1);
  await reopened.savePlan();
  const saved = await c.request('GET', '/plans/' + plan.id);
  expect(saved.name).toBe('回执等待时继续修改');
  expect(saved.version).toBe(plan.version + 2);
  expect(c.pending()).toHaveLength(0);
});

it('a plan patch receipt keeps changes entered while saving and advances their persisted version', async () => {
  const plan = await activePlan();
  await import('../src/pages/plan-detail/index');
  const p = page();
  p.onLoad({ id: plan.id });
  await p.load();
  p.adjust();
  p.data.editorForm.name = '发送中的修改';
  const gate = { held: () => {} } as { held: () => void; release?: () => void };
  const held = new Promise<void>((resolve) => {
    gate.held = resolve;
  });
  holdPatch = gate;
  const saving = p.savePlan();
  await held;
  p.planInput({
    currentTarget: { dataset: { field: 'name' } },
    detail: { value: '保存中继续填写' },
  });
  gate.release!();
  await saving;
  expect((await c.request('GET', '/plans/' + plan.id)).name).toBe(
    '发送中的修改',
  );
  expect(p.data.editing).toBe(true);
  expect(p.data.editorForm.name).toBe('保存中继续填写');
  expect(p.data.editorVersion).toBe(plan.version + 1);
  const reopened = page();
  reopened.onLoad({ id: plan.id });
  await reopened.load();
  expect(reopened.data.editorForm.name).toBe('保存中继续填写');
  expect(reopened.data.editorVersion).toBe(plan.version + 1);
  await reopened.savePlan();
  expect((await c.request('GET', '/plans/' + plan.id)).name).toBe(
    '保存中继续填写',
  );
  expect(c.pending()).toHaveLength(0);
});

it('explicit reload recovers a conflicted plan form from the current server plan before saving', async () => {
  const plan = await activePlan();
  await import('../src/pages/plan-detail/index');
  const p = page();
  p.onLoad({ id: plan.id });
  await p.load();
  p.adjust();
  p.data.editorForm.name = '旧编辑器的修改';
  await c.mutate(
    '/plans/' + plan.id,
    { expected_version: plan.version, patch: { name: '外部最新计划' } },
    'PATCH',
  );
  await p.savePlan();
  expect(c.pending()).toHaveLength(1);
  expect((await c.request('GET', '/plans/' + plan.id)).name).toBe(
    '外部最新计划',
  );
  expect(p.reloadEditor).toBeTypeOf('function');
  await p.reloadEditor();
  expect(p.data.editorForm.name).toBe('外部最新计划');
  expect(p.data.editorVersion).toBe(plan.version + 1);
  expect(p.data.editing).toBe(true);
  expect(c.pending()).toHaveLength(0);
  expect(c.saved<any>(p.editorKey(), null).version).toBe(plan.version + 1);
  p.data.editorForm.name = '基于最新版本修改';
  await p.savePlan();
  expect((await c.request('GET', '/plans/' + plan.id)).name).toBe(
    '基于最新版本修改',
  );
  expect(p.data.error).toBe('');
});

it('completed history can correct an actual set while preserving its unknown load', async () => {
  const plan = await activePlan();
  const session = await c.mutate('/workout-sessions', {
    workout_day_id: plan.days[0].id,
  });
  const saved = await c.mutate('/workout-sessions/' + session.id + '/sets', {
    exercise_id: 'bench',
    weight_kg: null,
    reps: 10,
    rpe: 7,
  });
  await c.mutate('/workout-sessions/' + session.id + '/transition', {
    expected_version: saved.session.version,
    action: 'complete',
  });
  await import('../src/pages/workout/index');
  const p = page();
  p.onLoad({ id: session.id });
  await p.load();
  expect(p.editSet).toBeTypeOf('function');
  p.editSet(event(saved.set.id));
  p.data.reps = '9';
  p.data.rpe = '8';
  await p.recordSet();
  const actual = await c.request('GET', '/workout-sessions/' + session.id);
  expect(actual.sets).toHaveLength(1);
  expect(actual.sets[0]).toMatchObject({
    reps: 9,
    weight_kg: null,
    rpe: 8,
    version: 2,
  });
  expect(actual.status).toBe('completed');
  expect(p.data.edit).toBeNull();
});

it('correcting a historical session date moves all of its actual sets together', async () => {
  const plan = await activePlan();
  const session = await c.mutate('/workout-sessions', {
    workout_day_id: plan.days[0].id,
  });
  const saved = await c.mutate('/workout-sessions/' + session.id + '/sets', {
    exercise_id: 'bench',
    weight_kg: 30,
    reps: 10,
  });
  await c.mutate('/workout-sessions/' + session.id + '/transition', {
    expected_version: saved.session.version,
    action: 'complete',
  });
  await import('../src/pages/workout/index');
  const p = page();
  p.onLoad({ id: session.id });
  await p.load();
  p.data.dateCorrection = '2026-10-10';
  await p.transition({ currentTarget: { dataset: { action: 'change_date' } } });
  const actual = await c.request('GET', '/workout-sessions/' + session.id);
  expect(actual.local_date).toBe('2026-10-10');
  expect(actual.sets[0].local_date).toBe('2026-10-10');
});

it('a saved actual set starts a cached rest timer and clears only the submitted input', async () => {
  const plan = await activePlan();
  const session = await c.mutate('/workout-sessions', {
    workout_day_id: plan.days[0].id,
  });
  await import('../src/pages/workout/index');
  const p = page();
  await p.load();
  p.data.reps = '8';
  p.data.weight = '30';
  p.data.rpe = '7';
  await p.recordSet();
  expect(p.data.sets[0].rpe).toBe(7);
  expect(c.saved<number>('rest.' + session.id, 0)).toBeGreaterThan(Date.now());
  expect(p.data.restRemaining).toBeGreaterThan(0);
  expect(p.data.restRemaining).toBeLessThanOrEqual(90);
  expect(p.data.weight).toBe('');
  expect(p.data.reps).toBe('');
  expect(p.data.rpe).toBe('');
  p.endRest();
  expect(c.saved('rest.' + session.id, -1)).toBe(0);
});

it('manual draft structural edits save distinct real days and valid load conventions', async () => {
  await import('../src/pages/plans/index');
  const p = page();
  await p.load();
  p.newPlan();
  p.data.editorForm.name = '多日计划';
  p.data.editorForm.days[0].exercises[0].name = '卧推';
  p.addDay();
  p.data.editorForm.days[1].exercises[0].name = '哑铃划船';
  p.planLoad({
    currentTarget: { dataset: { day: 1, exercise: 0, key: 'per_hand' } },
  });
  p.addExercise({ currentTarget: { dataset: { day: 1 } } });
  p.data.editorForm.days[1].exercises[1].name = '多余动作';
  p.removeExercise({ currentTarget: { dataset: { day: 1, exercise: 1 } } });
  await p.savePlan();
  const plans = await c.request('GET', '/plans');
  expect(plans[0].days.map((d: any) => d.local_date)).toEqual([
    '2026-10-12',
    '2026-10-13',
  ]);
  expect(plans[0].days[1].exercises).toHaveLength(1);
  expect(plans[0].days[1].exercises[0].load_convention).toBe('per_hand');
  expect(plans[0].days[0].exercises[0].exercise_id).not.toBe(
    plans[0].days[1].exercises[0].exercise_id,
  );
});

it('plan confirmation activates its displayed draft and cancelled day cannot start', async () => {
  const draft = await c.mutate('/plans/drafts', {
    name: '待确认计划',
    days: [{ local_date: '2026-10-12', name: '推', exercises: [ex] }],
  });
  await import('../src/pages/plan-detail/index');
  const p = page();
  p.onLoad({ id: draft.id });
  await p.load();
  await p.confirm();
  expect(p.data.plan.status).toBe('active');
  await c.mutate('/plans/' + draft.id + '/cancel', {
    expected_version: p.data.plan.version,
  });
  await import('../src/pages/day/index');
  const d = page();
  d.onLoad({ id: draft.days[0].id });
  await d.load();
  await d.start();
  expect(d.data.day.status).toBe('cancelled');
  expect(await c.request('GET', '/workout-sessions')).toHaveLength(0);
});
