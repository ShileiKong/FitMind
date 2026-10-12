import { expect, it } from 'vitest';
import { LocalCore } from '../src/local/core';
import { platformStore } from './local-fixtures';
import { executeTool } from '../../api/src/modules/agent/tools';
import { explicitlyApproves } from '../../api/src/modules/agent/confirmation';
import { setupDraftPrompt } from '../src/lib/onboarding';
const ctx = {
  user_id: 'personal',
  request_id: 'message',
  idempotency_key: 'message',
  now_utc: '2026-10-11T10:00:00Z',
  timezone: 'Asia/Shanghai',
  reference_local_date: '2026-10-11',
};
for (const text of [
  '不要确认这个目标，我还要改',
  '我不同意确认',
  '可以确认这个目标吗？',
  '确认？',
  '这个目标怎么确认',
  '明天再确认',
  '确认先等等',
  '确认这件事先等等，我还要改',
  '只生成草案供我确认',
  '制定目标后待我确认',
  setupDraftPrompt(),
]) {
  it(
    'keeps a proposal draft for an unconfirmed user message: ' + text,
    async () => {
      const core = new LocalCore(platformStore(), () => new Date(ctx.now_utc));
      const target = await core.request(
        'POST',
        '/targets/drafts',
        {
          effective_from: '2026-10-11',
          water_ml: 2000,
          calories_kcal: 2000,
          carbs_g: 200,
          protein_g: 140,
          fat_g: 60,
        },
        'draft',
      );
      await expect(
        executeTool(
          { services: core.services } as any,
          ctx,
          { text },
          'confirm_proposal',
          { type: 'target', id: target.id, expected_version: target.version },
        ),
      ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
      expect(core.services.targets.list('personal')[0].status).toBe('draft');
    },
  );
}
for (const text of ['同意，下次加重', '确认，下次加重', '下次加重']) {
  it('allows current acceptance for next workout: ' + text, () => {
    expect(explicitlyApproves(text, 'recommendation')).toBe(true);
  });
}
for (const text of ['不要加重', '别接受这个加重建议', '加重可以吗？']) {
  it('rejects negated or interrogative acceptance: ' + text, async () => {
    const core = new LocalCore(platformStore(), () => new Date(ctx.now_utc));
    await expect(
      executeTool(
        { services: core.services } as any,
        ctx,
        { text },
        'accept_recommendation',
        { id: 'not-accepted', expected_version: 1 },
      ),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
  });
}
for (const text of ['确认这个目标', '同意，就按这个执行', '就按这样']) {
  it(
    'still confirms a uniquely identified proposal on explicit approval: ' +
      text,
    async () => {
      const core = new LocalCore(platformStore(), () => new Date(ctx.now_utc));
      const target = await core.request(
        'POST',
        '/targets/drafts',
        {
          effective_from: '2026-10-11',
          water_ml: 2000,
          calories_kcal: 2000,
          carbs_g: 200,
          protein_g: 140,
          fat_g: 60,
        },
        'draft',
      );
      const result: any = await executeTool(
        { services: core.services } as any,
        ctx,
        { text },
        'confirm_proposal',
        { type: 'target', id: target.id, expected_version: target.version },
      );
      expect(result.status).toBe('active');
    },
  );
}
