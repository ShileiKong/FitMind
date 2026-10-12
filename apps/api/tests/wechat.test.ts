import { afterEach, expect, it } from 'vitest';
import { makeHarness } from './helpers.js';
import { WechatService } from '../src/modules/wechat/service.js';
let h: any;
afterEach(async () => {
  if (h) await h.close();
  h = null;
});
it('an entirely unconfigured account still lets the API start', async () => {
  h = await makeHarness();
  expect(new WechatService(h.app).config()).toEqual({
    enabled: false,
    paired: false,
    available: 0,
    template_id: null,
    last_error: null,
  });
});
const ex = {
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
};
async function setup(mode = 'success') {
  let now = new Date('2026-10-11T12:50:00Z');
  h = await makeHarness({ clock: () => now });
  const sent: any[] = [];
  let codes = 0;
  let openid = 'personal-openid';
  let beforeSend: (() => Promise<void>) | null = null;
  let beforeToken: (() => Promise<void>) | null = null;
  const transport: any = async (url: string, init: any) => {
    if (url.includes('jscode2session')) {
      codes++;
      return Response.json({
        openid,
        session_key: 'server-only',
      });
    }
    if (url.includes('/token?')) {
      if (beforeToken) await beforeToken();
      return Response.json({
        access_token: 'wechat-server-only',
        expires_in: 7200,
      });
    }
    sent.push(JSON.parse(init.body));
    if (beforeSend) await beforeSend();
    if (mode === 'network') throw new Error('socket closed after send');
    return Response.json({ errcode: mode === 'reject' ? 43101 : 0 });
  };
  const service = new WechatService(h.app, {
    appid: 'wx0123456789abcdef',
    secret: 'server-secret',
    template_id: 'template-1',
    fields: { thing1: 'name', date2: 'date', thing3: 'summary' },
    fetch: transport,
  });
  await service.pair(
    { ...h.ctx, idempotency_key: 'pair' },
    { code: 'wechat-code' },
  );
  service.subscribe(
    { ...h.ctx, idempotency_key: 'subscribe' },
    { template_id: 'template-1', accepted: true },
  );
  const p = await h.services.plans.createDraft(
    { ...h.ctx, idempotency_key: 'plan' },
    {
      name: '周计划',
      days: [{ local_date: '2026-10-12', name: '胸肩训练', exercises: [ex] }],
    },
  );
  return {
    service,
    sent,
    plan: p,
    setNow: (s: string) => {
      now = new Date(s);
    },
    codes: () => codes,
    setOpenid: (value: string) => {
      openid = value;
    },
    setBeforeSend: (f: () => Promise<void>) => {
      beforeSend = f;
    },
    setBeforeToken: (f: () => Promise<void>) => {
      beforeToken = f;
    },
  };
}
it('does not expose secrets or claim reminders are configured without credentials', async () => {
  h = await makeHarness();
  const service = new WechatService(h.app, {
    appid: 'wx0123456789abcdef',
    secret: 'secret',
  });
  expect(service.config()).toEqual({
    enabled: false,
    paired: false,
    available: 0,
    template_id: null,
    last_error: null,
  });
  await expect(service.pair(h.ctx, { code: 'x' })).rejects.toMatchObject({
    code: 'WECHAT_UNCONFIGURED',
  });
});
it('rejects subscriptions before pairing or for an unexpected template', async () => {
  h = await makeHarness();
  const service = new WechatService(h.app, {
    appid: 'wx0123456789abcdef',
    secret: 's',
    template_id: 't',
    fields: { thing1: 'name' },
  });
  expect(() =>
    service.subscribe(h.ctx, { template_id: 't', accepted: true }),
  ).toThrow('先连接');
});
it('replaying a paired login does not reuse the consumed WeChat code', async () => {
  const s = await setup();
  await s.service.pair(
    { ...h.ctx, idempotency_key: 'pair' },
    { code: 'wechat-code' },
  );
  expect(s.codes()).toBe(1);
  expect(JSON.stringify(s.service.config())).not.toContain('secret');
  expect(() =>
    s.service.subscribe(
      { ...h.ctx, idempotency_key: 'wrong' },
      { template_id: 'different', accepted: true },
    ),
  ).toThrow();
});
it('sends at the previous evening time exactly once and opens the corresponding plan', async () => {
  const s = await setup();
  await h.services.plans.confirm(
    { ...h.ctx, idempotency_key: 'confirm' },
    s.plan.id,
    1,
  );
  await s.service.tick();
  expect(s.sent).toHaveLength(0);
  s.setNow('2026-10-11T13:00:00Z');
  await s.service.tick();
  await s.service.tick();
  expect(s.sent).toHaveLength(1);
  expect(s.sent[0]).toMatchObject({
    touser: 'personal-openid',
    template_id: 'template-1',
    miniprogram_state: 'trial',
    data: { thing1: { value: '胸肩训练' }, date2: { value: '2026-10-12' } },
  });
  expect(s.sent[0].page).toBe(
    'pages/plan-detail/index?id=' + s.plan.id + '&day=' + s.plan.days[0].id,
  );
  expect(s.service.config().available).toBe(0);
});
it('does not send draft or cancelled plans', async () => {
  const s = await setup();
  s.setNow('2026-10-11T13:00:00Z');
  await s.service.tick();
  expect(s.sent).toHaveLength(0);
  await h.services.plans.confirm(
    { ...h.ctx, idempotency_key: 'confirm' },
    s.plan.id,
    1,
  );
  await h.services.plans.cancel(
    { ...h.ctx, idempotency_key: 'cancel' },
    s.plan.id,
    2,
  );
  await s.service.tick();
  expect(s.sent).toHaveLength(0);
});
it('records revoked subscription permission and stops attempting delivery', async () => {
  const s = await setup('reject');
  await h.services.plans.confirm(
    { ...h.ctx, idempotency_key: 'confirm' },
    s.plan.id,
    1,
  );
  s.setNow('2026-10-11T13:00:00Z');
  await s.service.tick();
  await s.service.tick();
  expect(s.sent).toHaveLength(1);
  expect(s.service.config().last_error).toContain('订阅');
  expect(s.service.config().available).toBe(0);
});
it('does not blindly resend when the network outcome is uncertain', async () => {
  const s = await setup('network');
  await h.services.plans.confirm(
    { ...h.ctx, idempotency_key: 'confirm' },
    s.plan.id,
    1,
  );
  s.setNow('2026-10-11T13:00:00Z');
  await s.service.tick();
  await s.service.tick();
  expect(s.sent).toHaveLength(1);
  expect(s.service.config().last_error).toContain('确认');
});
it('does not backfill stale reminders after a long server outage', async () => {
  const s = await setup();
  await h.services.plans.confirm(
    { ...h.ctx, idempotency_key: 'confirm' },
    s.plan.id,
    1,
  );
  s.setNow('2026-10-12T02:00:00Z');
  await s.service.tick();
  expect(s.sent).toHaveLength(0);
});
it('duplicate subscription reports only credit once', async () => {
  const s = await setup();
  s.service.subscribe(
    { ...h.ctx, idempotency_key: 'subscribe' },
    { template_id: 'template-1', accepted: true },
  );
  expect(s.service.config().available).toBe(1);
});
it('cancellation during access-token acquisition prevents notification', async () => {
  const s = await setup();
  await h.services.plans.confirm(
    { ...h.ctx, idempotency_key: 'confirm' },
    s.plan.id,
    1,
  );
  s.setBeforeToken(async () => {
    await h.services.plans.cancel(
      { ...h.ctx, idempotency_key: 'cancel' },
      s.plan.id,
      2,
    );
  });
  s.setNow('2026-10-11T13:00:00Z');
  await s.service.tick();
  expect(s.sent).toHaveLength(0);
  expect(s.service.config().available).toBe(1);
});
it('an old recipient send failure cannot revoke a new pairing and subscriptions', async () => {
  const s = await setup('reject');
  await h.services.plans.confirm(
    { ...h.ctx, idempotency_key: 'confirm' },
    s.plan.id,
    1,
  );
  s.setBeforeSend(async () => {
    s.setOpenid('new-recipient');
    await s.service.pair(
      { ...h.ctx, idempotency_key: 'new-pair' },
      { code: 'new-code' },
    );
    for (let i = 0; i < 3; i++)
      s.service.subscribe(
        { ...h.ctx, idempotency_key: 'new-credit-' + i },
        { template_id: 'template-1', accepted: true },
      );
  });
  s.setNow('2026-10-11T13:00:00Z');
  await s.service.tick();
  expect(s.service.config()).toMatchObject({
    paired: true,
    available: 3,
    last_error: null,
  });
});
it('send failure preserves subscription credits obtained while that send was pending', async () => {
  const s = await setup('reject');
  await h.services.plans.confirm(
    { ...h.ctx, idempotency_key: 'confirm' },
    s.plan.id,
    1,
  );
  s.setBeforeSend(async () => {
    for (let i = 0; i < 2; i++)
      s.service.subscribe(
        { ...h.ctx, idempotency_key: 'later-credit-' + i },
        { template_id: 'template-1', accepted: true },
      );
  });
  s.setNow('2026-10-11T13:00:00Z');
  await s.service.tick();
  expect(s.service.config().available).toBe(2);
});
it('token acquisition failure cannot restore a stale recipient binding', async () => {
  const s = await setup();
  await h.services.plans.confirm(
    { ...h.ctx, idempotency_key: 'confirm' },
    s.plan.id,
    1,
  );
  s.setBeforeToken(async () => {
    s.setOpenid('new-recipient');
    await s.service.pair(
      { ...h.ctx, idempotency_key: 'new-pair' },
      { code: 'new-code' },
    );
    s.service.subscribe(
      { ...h.ctx, idempotency_key: 'new-credit' },
      { template_id: 'template-1', accepted: true },
    );
    throw new Error('token network failure');
  });
  s.setNow('2026-10-11T13:00:00Z');
  await s.service.tick();
  expect(h.app.store.list('personal', 'wechat-binding')[0]).toMatchObject({
    openid: 'new-recipient',
    available: 1,
    last_error: null,
  });
});
it('credits for one message template cannot authorize a different template', async () => {
  const s = await setup();
  const changed = new WechatService(h.app, {
    appid: 'wx0123456789abcdef',
    secret: 's',
    template_id: 'new-template',
    fields: { thing1: 'name' },
  });
  expect(changed.config().available).toBe(0);
  expect(s.service.config().available).toBe(1);
});
