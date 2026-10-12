import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalClient } from '../src/local/client';
import { platformStore } from './local-fixtures';
import { executeTool } from '../../api/src/modules/agent/tools';
import {
  nextSetupQuestion,
  parseSetupAnswer,
  setupSummary,
} from '../src/lib/onboarding';

afterEach(() => vi.unstubAllGlobals());
const clock = () => new Date('2026-10-11T10:00:00Z');
const ctx = {
  user_id: 'personal',
  request_id: 'setup',
  idempotency_key: 'setup',
  now_utc: clock().toISOString(),
  timezone: 'Asia/Shanghai',
  reference_local_date: '2026-10-11',
  source_message_id: 'setup',
};

describe('coach setup questions', () => {
  it.each(['我现在72kg，177cm', '身高177，体重72', '身高1.77米，体重72公斤'])(
    'recognizes explicitly described body measurements: %s',
    (text) => {
      expect(parseSetupAnswer('body', text)).toEqual({
        height_cm: 177,
        weight_kg: 72,
      });
    },
  );
  it('accepts a partial answer, asks only for the remaining body fact, and rejects ambiguous numbers', () => {
    const fitness = parseSetupAnswer('body', '我的体重72公斤');
    expect(fitness).toEqual({ weight_kg: 72 });
    expect(nextSetupQuestion({ fitness }).text).toContain('身高');
    expect(nextSetupQuestion({ fitness }).text).not.toContain('体重');
    expect(() => parseSetupAnswer('body', '我吃了177克牛肉，72克面')).toThrow();
    expect(parseSetupAnswer('body', '177', fitness)).toEqual({
      height_cm: 177,
    });
    expect(() => parseSetupAnswer('body', '-177cm，72kg')).toThrow();
    expect(() => parseSetupAnswer('body', '0cm，72kg')).toThrow();
  });
  it('uses optional skip values without inventing gender or injury clearance', () => {
    expect(parseSetupAnswer('sex', '暂不透露')).toEqual({ sex: 'unspecified' });
    expect(parseSetupAnswer('strength', '还不确定')).toEqual({
      strength_training: 'unsure',
    });
    expect(parseSetupAnswer('strength', '可以，但不想去健身房')).toEqual({
      strength_training: 'yes',
    });
    expect(parseSetupAnswer('strength', '我不太愿意做力量训练')).toEqual({
      strength_training: 'no',
    });
    expect(parseSetupAnswer('strength', '我觉得还是不要力量训练')).toEqual({
      strength_training: 'no',
    });
    expect(parseSetupAnswer('limitations', '跳过')).toEqual({
      limitations: '暂未提供',
    });
    expect(parseSetupAnswer('availability', '每周四五六早上')).toEqual({
      availability_text: '每周四五六早上',
    });
  });
  it('resumes from saved facts and reaches a review without silently completing', () => {
    const fitness: any = {};
    for (const answer of [
      '72kg 177cm',
      '男',
      '薄肌塑形',
      '可以',
      '每周四五六早上',
      '膝盖曾受伤，在家有哑铃',
    ]) {
      const question = nextSetupQuestion({ fitness });
      Object.assign(fitness, parseSetupAnswer(question.id, answer));
    }
    expect(nextSetupQuestion({ fitness }).id).toBe('review');
    expect(
      setupSummary(fitness).find((row) => row.id === 'limitations')?.value,
    ).toContain('膝盖');
    expect(
      nextSetupQuestion({ fitness, onboarding_status: 'completed' }).id,
    ).toBe('review');
  });
});

async function setupPage(c: LocalClient) {
  vi.resetModules();
  let definition: any;
  vi.stubGlobal('getApp', () => ({ client: c }));
  vi.stubGlobal('Page', (p: any) => {
    definition = p;
  });
  vi.stubGlobal('wx', {
    showToast: vi.fn(),
    navigateTo: vi.fn(),
    switchTab: vi.fn(),
  });
  await import('../src/pages/onboarding/index');
  const p: any = {
    ...definition,
    data: structuredClone(definition.data),
    setData(values: any) {
      Object.assign(this.data, values);
    },
  };
  await p.load();
  return p;
}
const answer = async (p: any, text: string) => {
  p.input({ detail: { value: text } });
  await p.submit();
};

describe('guided setup page', () => {
  it('reuses a real previously recorded weight without asking or recording it again', async () => {
    const c = new LocalClient(platformStore(), clock);
    await c.mutate('/records', {
      kind: 'body',
      metric: 'weight_kg',
      value: 72,
      local_date: '2026-10-11',
    });
    const p = await setupPage(c);
    expect(p.data.question.text).toBe('你的身高是多少？');
    expect(p.data.knownBodyLabel).toContain('72');
    await answer(p, '177');
    expect(c.data.profile.fitness).toEqual({ height_cm: 177, weight_kg: 72 });
    expect(p.data.question.id).toBe('sex');
    expect(c.data.records.filter((r: any) => r.kind === 'body')).toHaveLength(
      1,
    );
  });
  it('saves each answer and resumes after reopening, while skipping remains nonblocking', async () => {
    const c = new LocalClient(platformStore(), clock);
    let p = await setupPage(c);
    await answer(p, '177cm，72kg');
    expect(p.data.question.id).toBe('sex');
    p = await setupPage(c);
    expect(p.data.question.id).toBe('sex');
    await p.skipSetup();
    expect(c.data.profile.onboarding_status).toBe('skipped');
    expect(c.data.profile.fitness.height_cm).toBe(177);
    p = await setupPage(c);
    expect(p.data.question.id).toBe('sex');
  });
  it('keeps a typed answer after storage failure and only advances after a real successful retry', async () => {
    const platform = platformStore(),
      c = new LocalClient(platform, clock);
    const p = await setupPage(c);
    p.input({ detail: { value: '177cm，72kg' } });
    platform.failWrites(true);
    await p.submit();
    expect(p.data.answer).toBe('177cm，72kg');
    expect(p.data.question.id).toBe('body');
    expect(p.data.error).toBeTruthy();
    expect(c.data.profile.version).toBe(0);
    platform.failWrites(false);
    await p.submit();
    expect(p.data.question.id).toBe('sex');
    expect(p.data.answer).toBe('');
  });
  it('restores an answer after a committed save loses its acknowledgement, and retries only that original save', async () => {
    const platform = platformStore(),
      c = new LocalClient(platform, clock);
    await c.mutate('/records', {
      kind: 'body',
      metric: 'weight_kg',
      value: 72,
    });
    let p = await setupPage(c),
      lose = true;
    const write = platform.setStorageSync.bind(platform);
    platform.setStorageSync = (key, value) => {
      if (
        lose &&
        key.endsWith('.pending') &&
        Array.isArray(value) &&
        value.length === 0
      ) {
        lose = false;
        throw new Error('lost acknowledgement');
      }
      write(key, value);
    };
    await answer(p, '177');
    expect(c.pending()).toHaveLength(1);
    p = await setupPage(c);
    expect(p.data.answer).toBe('177');
    expect(p.data.question.id).toBe('body');
    await p.retryInput({ detail: { id: c.pending()[0].id } });
    expect(p.data.answer).toBe('');
    expect(p.data.question.id).toBe('sex');
    expect(c.data.profile.version).toBe(1);
    expect(c.pending()).toHaveLength(0);
  });
  it('keeps a changed answer with its original question when retry completes an older save', async () => {
    const platform = platformStore(),
      c = new LocalClient(platform, clock);
    await c.mutate('/records', {
      kind: 'body',
      metric: 'weight_kg',
      value: 72,
    });
    const p = await setupPage(c),
      write = platform.setStorageSync.bind(platform);
    let lose = true;
    platform.setStorageSync = (key, value) => {
      if (
        lose &&
        key.endsWith('.pending') &&
        Array.isArray(value) &&
        value.length === 0
      ) {
        lose = false;
        throw new Error('lost acknowledgement');
      }
      write(key, value);
    };
    await answer(p, '177');
    p.input({ detail: { value: '178' } });
    await p.retryInput({ detail: { id: c.pending()[0].id } });
    expect(p.data.answer).toBe('178');
    expect(p.data.question.id).toBe('body');
    expect(c.data.profile.fitness.height_cm).toBe(177);
    await p.submit();
    expect(c.data.profile.fitness.height_cm).toBe(178);
    expect(p.data.question.id).toBe('sex');
    expect(p.data.answer).toBe('');
  });
  it('clears previous scope answers and edit-step after replacing data', async () => {
    const c = new LocalClient(platformStore(), clock),
      p = await setupPage(c);
    await answer(p, '177cm，72kg');
    p.edit({ currentTarget: { dataset: { step: 'body' } } });
    p.input({ detail: { value: '172cm，62kg' } });
    const empty = new LocalClient(platformStore(), clock).exportBackup();
    await c.importBackup(empty);
    await p.load();
    expect(p.data.answer).toBe('');
    expect(p.data.question.id).toBe('body');
    expect(p.data.rows[0].value).toContain('—');
  });
  it('completes without a model and does not manufacture targets or plans', async () => {
    const c = new LocalClient(platformStore(), clock),
      p = await setupPage(c);
    for (const text of [
      '177cm 72kg',
      '暂不透露',
      '薄肌',
      '还不确定',
      '暂未确定',
      '跳过',
    ])
      await answer(p, text);
    expect(p.data.question.id).toBe('review');
    expect(c.data.profile.onboarding_status).toBe('in_progress');
    await p.finish();
    expect(c.data.profile.onboarding_status).toBe('completed');
    expect(p.data.completed).toBe(true);
    expect(p.data.hasAI).toBe(false);
    expect(c.data.plans).toHaveLength(0);
    expect(c.data.targets).toHaveLength(0);
  });
  it('keeps completed facts on model failure, then recovers a real draft without activating it', async () => {
    const platform: any = platformStore();
    let fail = true,
      calls = 0;
    platform.request = (options: any) => {
      calls++;
      queueMicrotask(() => {
        if (fail) options.fail({ errMsg: 'request:fail network' });
        else
          options.success({
            statusCode: 200,
            data: {
              choices: [
                {
                  finish_reason: calls === 2 ? 'tool_calls' : 'stop',
                  message:
                    calls === 2
                      ? {
                          content: null,
                          tool_calls: [
                            {
                              id: 'setup-target',
                              type: 'function',
                              function: {
                                name: 'draft_target',
                                arguments: JSON.stringify({
                                  input: {
                                    effective_from: '2026-10-11',
                                    water_ml: 2500,
                                    calories_kcal: 2000,
                                    carbs_g: 220,
                                    protein_g: 120,
                                    fat_g: 65,
                                  },
                                }),
                              },
                            },
                          ],
                        }
                      : { content: '目标已生成，请查看并确认。' },
                },
              ],
            },
          });
      });
      return { abort() {} };
    };
    const c = new LocalClient(platform, clock);
    c.agent.saveModel({ api_key: 'synthetic-test', model: 'deepseek-flash' });
    const p = await setupPage(c);
    for (const text of [
      '177cm 72kg',
      '男',
      '减脂',
      '可以',
      '每周四五六',
      '在家有哑铃',
    ])
      await answer(p, text);
    await p.suggest();
    expect(c.data.profile.onboarding_status).toBe('completed');
    expect(c.data.targets).toHaveLength(0);
    expect(p.data.suggestion.errors.length).toBeGreaterThan(0);
    expect(p.data.suggestion.result.error.retryable).toBe(true);
    fail = false;
    await p.recoverSuggestion();
    expect(c.data.targets).toHaveLength(1);
    expect(c.data.targets[0].status).toBe('draft');
    expect(p.data.suggestion.proposals[0].id).toBe(c.data.targets[0].id);
    expect(c.data.plans).toHaveLength(0);
    expect(c.data.messages).toHaveLength(1);
    expect(c.exportBackup()).not.toContain('synthetic-test');
  });
});

describe('first coach setup data', () => {
  it('persists progressive facts and merges a later conversational correction without losing preferences', async () => {
    const platform = platformStore();
    const c = new LocalClient(platform, clock);
    const first = await c.mutate(
      '/profile',
      {
        expected_version: 0,
        fitness: {
          height_cm: 177,
          weight_kg: 72,
          goal: '薄肌塑形',
          strength_training: 'yes',
          availability_text: '每周四五六早上',
        },
        onboarding_status: 'in_progress',
      },
      'PATCH',
    );
    const result: any = await executeTool(
      { services: c.core.services } as any,
      ctx,
      { text: '我的体重改成71公斤' },
      'update_profile',
      {
        expected_version: first.version,
        patch_json: JSON.stringify({ fitness: { weight_kg: 71 } }),
      },
    );
    expect(result.fitness).toEqual({
      height_cm: 177,
      weight_kg: 71,
      goal: '薄肌塑形',
      strength_training: 'yes',
      availability_text: '每周四五六早上',
    });
    await c.mutate(
      '/profile',
      { expected_version: result.version, onboarding_status: 'completed' },
      'PATCH',
    );
    const restored = new LocalClient(platform, clock);
    await restored.refresh();
    expect(restored.data.profile.fitness.weight_kg).toBe(71);
    expect(restored.data.profile.onboarding_status).toBe('completed');
    expect(restored.data.targets).toEqual([]);
    expect(restored.data.plans).toEqual([]);
    const backup = restored.exportBackup();
    restored.inspectBackup(backup);
    await restored.importBackup(backup);
    expect(restored.data.profile.fitness.height_cm).toBe(177);
  });

  it.each([
    { height_cm: -177 },
    { weight_kg: '72' },
    { sex: 'guessed' },
    { unknown: 'data' },
  ])(
    'rejects invalid setup facts without changing the profile %j',
    async (fitness) => {
      const c = new LocalClient(platformStore(), clock);
      await expect(
        c.mutate('/profile', { expected_version: 0, fitness }, 'PATCH'),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      expect((await c.request('GET', '/profile')).version).toBe(0);
    },
  );

  it('does not mark missing body and training choices as completed', async () => {
    const c = new LocalClient(platformStore(), clock);
    await expect(
      c.mutate(
        '/profile',
        {
          expected_version: 0,
          fitness: { goal: '增肌' },
          onboarding_status: 'completed',
        },
        'PATCH',
      ),
    ).rejects.toMatchObject({ code: 'SETUP_INCOMPLETE' });
    expect((await c.request('GET', '/profile')).version).toBe(0);
  });

  it('rejects a tampered fitness backup before changing the old storage scope', async () => {
    const c = new LocalClient(platformStore(), clock);
    await c.mutate(
      '/profile',
      {
        expected_version: 0,
        fitness: { height_cm: 177, weight_kg: 72 },
        onboarding_status: 'in_progress',
      },
      'PATCH',
    );
    const backup = JSON.parse(c.exportBackup());
    backup.entities.find(
      (entry: any) => entry.kind === 'profile',
    ).value.fitness.height_cm = 'fake';
    const before = c.exportBackup(),
      scope = c.storageKey;
    expect(() => c.inspectBackup(JSON.stringify(backup))).toThrow();
    await expect(c.importBackup(JSON.stringify(backup))).rejects.toThrow();
    expect(c.exportBackup()).toBe(before);
    expect(c.storageKey).toBe(scope);
  });
});
