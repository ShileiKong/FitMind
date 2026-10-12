import type { FitMindApp } from '../../app.js';
import type { CommandContext } from '@fitmind/contracts';
import { createHash } from 'node:crypto';
import { invariant, DomainError } from '../../http/errors.js';
import { zonedLocalToUtc } from '../reminders/service.js';
import { resolveDate } from '../time/service.js';
export interface WechatOptions {
  appid?: string;
  secret?: string;
  template_id?: string;
  fields?: Record<string, string>;
  fetch?: typeof fetch;
}
export function wechatOptions(): WechatOptions {
  let fields: Record<string, string> = {};
  try {
    fields = JSON.parse(process.env.WECHAT_TEMPLATE_FIELDS || '{}');
  } catch {
    /* Invalid settings disable sending. */
  }
  return {
    appid: process.env.WECHAT_APP_ID,
    secret: process.env.WECHAT_APP_SECRET,
    template_id: process.env.WECHAT_TEMPLATE_ID,
    fields,
  };
}
export class WechatService {
  private token: { value: string; expires: number } | null = null;
  private ticking = false;
  constructor(
    private app: FitMindApp,
    private options: WechatOptions = {},
  ) {}
  private enabled() {
    const fields = this.options.fields;
    return !!(
      /^wx[a-f0-9]{16}$/.test(this.options.appid || '') &&
      this.options.secret &&
      this.options.template_id &&
      fields &&
      !Array.isArray(fields) &&
      Object.entries(fields).length &&
      Object.entries(fields).every(
        ([k, v]) =>
          /^(thing|date|time|character_string)\d+$/.test(k) &&
          ['name', 'date', 'time', 'summary'].includes(v),
      )
    );
  }
  private binding() {
    return this.app.store.list<any>('personal', 'wechat-binding')[0] || null;
  }
  private sameBinding(a: any, b: any) {
    return (
      !!a &&
      !!b &&
      a.openid === b.openid &&
      a.appid === b.appid &&
      a.template_id === b.template_id
    );
  }
  config(): any {
    const enabled = this.enabled(),
      b = this.binding(),
      sameApp = !!b && b.appid === this.options.appid;
    return {
      enabled,
      paired: sameApp,
      available:
        sameApp && b.template_id === this.options.template_id ? b.available : 0,
      template_id: enabled ? this.options.template_id : null,
      last_error: sameApp ? b.last_error || null : null,
    };
  }
  private async json(url: string, init?: RequestInit) {
    let r: Response;
    try {
      r = await (this.options.fetch || fetch)(url, {
        ...init,
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      throw new DomainError(
        'WECHAT_NETWORK',
        '微信请求结果无法确认，请稍后检查提醒状态',
        503,
        true,
      );
    }
    let data: any;
    try {
      data = await r.json();
    } catch {
      throw new DomainError('WECHAT_RESPONSE', '微信服务返回异常', 502, true);
    }
    if (!r.ok)
      throw new DomainError('WECHAT_RESPONSE', '微信服务暂时不可用', 502, true);
    return data;
  }
  async pair(ctx: CommandContext, input: { code: string }): Promise<any> {
    invariant(
      this.enabled(),
      'WECHAT_UNCONFIGURED',
      '后端尚未配置微信账号与订阅模板',
      503,
    );
    invariant(
      ctx.idempotency_key,
      'IDEMPOTENCY_REQUIRED',
      '写入必须提供 Idempotency-Key',
    );
    const prior = this.app.store.db
      .prepare(
        'SELECT result FROM operations WHERE user_id=? AND scope=? AND op_key=?',
      )
      .get(ctx.user_id, 'wechat.pair', ctx.idempotency_key);
    if (prior)
      return this.app.store.mutate(ctx, 'wechat.pair', input, () => {
        throw new Error('Existing operation must replay');
      });
    const q = new URLSearchParams({
      appid: this.options.appid!,
      secret: this.options.secret!,
      js_code: input.code,
      grant_type: 'authorization_code',
    });
    const result = await this.json(
      'https://api.weixin.qq.com/sns/jscode2session?' + q,
    );
    invariant(
      !result.errcode && result.openid,
      'WECHAT_LOGIN_FAILED',
      '微信登录失败，请重新连接微信',
    );
    return this.app.store.mutate(ctx, 'wechat.pair', input, () => {
      const old = this.binding();
      this.app.store.put(ctx.user_id, 'wechat-binding', {
        id: 'wechat-personal',
        version: (old?.version || 0) + 1,
        appid: this.options.appid,
        template_id: this.options.template_id,
        openid: result.openid,
        available:
          old?.openid === result.openid &&
          old?.appid === this.options.appid &&
          old?.template_id === this.options.template_id
            ? old.available
            : 0,
        last_error: null,
      });
      return this.config();
    });
  }
  subscribe(
    ctx: CommandContext,
    input: { template_id: string; accepted: boolean },
  ) {
    invariant(
      this.enabled(),
      'WECHAT_UNCONFIGURED',
      '后端尚未配置微信订阅模板',
      503,
    );
    const b = this.binding();
    invariant(
      b && b.appid === this.options.appid,
      'WECHAT_UNPAIRED',
      '请先连接你的微信',
    );
    invariant(
      input.template_id === this.options.template_id,
      'WECHAT_TEMPLATE',
      '订阅模板不匹配',
    );
    invariant(input.accepted, 'WECHAT_REJECTED', '未同意订阅，不会发送提醒');
    return this.app.store.mutate(ctx, 'wechat.subscribe', input, () => {
      const current = this.binding();
      this.app.store.put(ctx.user_id, 'wechat-binding', {
        ...current,
        template_id: this.options.template_id,
        available: Math.min(
          100,
          (current.template_id === this.options.template_id
            ? current.available
            : 0) + 1,
        ),
        version: current.version + 1,
        last_error: null,
      });
      return this.config();
    });
  }
  private async accessToken() {
    const now = this.app.deps.clock().getTime();
    if (this.token && this.token.expires > now) return this.token.value;
    const q = new URLSearchParams({
      grant_type: 'client_credential',
      appid: this.options.appid!,
      secret: this.options.secret!,
    });
    const r = await this.json('https://api.weixin.qq.com/cgi-bin/token?' + q);
    invariant(
      r.access_token,
      'WECHAT_TOKEN',
      '获取微信服务凭据失败，请检查账号与 IP 白名单',
      503,
    );
    this.token = {
      value: r.access_token,
      expires: now + Math.max(60, (r.expires_in || 7200) - 120) * 1000,
    };
    return r.access_token;
  }
  async tick(): Promise<void> {
    if (this.ticking || !this.enabled()) return;
    const profile = this.app.services.profile.get('personal'),
      binding = this.binding();
    if (
      !profile.notifications_enabled ||
      !binding ||
      binding.appid !== this.options.appid ||
      binding.template_id !== this.options.template_id ||
      binding.available < 1
    )
      return;
    this.ticking = true;
    try {
      const now = this.app.deps.clock().getTime();
      for (const day of this.app.services.plans.days('personal')) {
        const fire = zonedLocalToUtc(
          resolveDate('昨天', day.local_date),
          profile.reminder_time,
          profile.timezone,
        );
        if (Date.parse(fire) > now || now - Date.parse(fire) > 10 * 60000)
          continue;
        const key =
          'wechat-delivery-' +
          createHash('sha256')
            .update(
              [
                this.options.appid,
                this.options.template_id,
                binding.openid,
                day.id,
                day.plan_version,
                fire,
              ].join('|'),
            )
            .digest('hex');
        if (
          this.app.store
            .list<any>('personal', 'wechat-delivery')
            .some((r) => r.id === key)
        )
          continue;
        let current = this.binding();
        if (!current || current.available < 1) break;
        let token: string;
        try {
          token = await this.accessToken();
        } catch (e: any) {
          const latest = this.binding();
          if (this.sameBinding(latest, current))
            this.app.store.put('personal', 'wechat-binding', {
              ...latest,
              version: latest.version + 1,
              last_error: e.message,
            });
          break;
        }
        const latestDay = this.app.services.plans
          .days('personal')
          .find(
            (d: any) => d.id === day.id && d.plan_version === day.plan_version,
          );
        const latestProfile = this.app.services.profile.get('personal');
        current = this.binding();
        if (
          !latestDay ||
          latestProfile.version !== profile.version ||
          !latestProfile.notifications_enabled ||
          !current ||
          current.openid !== binding.openid ||
          current.appid !== this.options.appid ||
          current.template_id !== this.options.template_id ||
          current.available < 1
        )
          continue;
        if (this.app.deps.clock().getTime() - Date.parse(fire) > 10 * 60000)
          continue;
        const event = {
          id: key,
          version: 1,
          workout_day_id: day.id,
          plan_version: day.plan_version,
          status: 'attempted',
          attempted_at: this.app.deps.clock().toISOString(),
        };
        this.app.store.transaction(() => {
          this.app.store.put('personal', 'wechat-delivery', event);
          this.app.store.put('personal', 'wechat-binding', {
            ...current,
            version: current.version + 1,
            available: current.available - 1,
            last_error: null,
          });
        });
        const values: Record<string, string> = {
          name: day.name,
          date: day.local_date,
          time:
            resolveDate('昨天', day.local_date) + ' ' + profile.reminder_time,
          summary: day.exercises.map((e: any) => e.name).join('、'),
        };
        const data = Object.fromEntries(
          Object.entries(this.options.fields!).map(([k, v]) => [
            k,
            {
              value: k.startsWith('thing')
                ? [...values[v]].slice(0, 20).join('')
                : values[v],
            },
          ]),
        );
        let status = 'sent',
          error: string | null = null;
        try {
          const r = await this.json(
            'https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=' +
              encodeURIComponent(token),
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                touser: binding.openid,
                template_id: this.options.template_id,
                page:
                  'pages/plan-detail/index?id=' +
                  encodeURIComponent(day.plan_id) +
                  '&day=' +
                  encodeURIComponent(day.id),
                data,
                miniprogram_state: 'trial',
                lang: 'zh_CN',
              }),
            },
          );
          if (r.errcode !== 0) {
            status = 'failed';
            error =
              r.errcode === 43101
                ? '微信订阅权限已失效或用完，请重新订阅。'
                : '微信提醒发送失败，请核对模板与账号权限。';
            if ([40001, 40014, 42001].includes(r.errcode)) this.token = null;
          }
        } catch {
          status = 'uncertain';
          error =
            '提醒发送结果无法确认，本次不会自动重复发送，请检查微信服务通知。';
        }
        const latest = this.binding();
        this.app.store.transaction(() => {
          this.app.store.put('personal', 'wechat-delivery', {
            ...event,
            version: 2,
            status,
            error,
          });
          if (this.sameBinding(latest, current)) {
            const newCredits = Math.max(
              0,
              latest.available - (current.available - 1),
            );
            this.app.store.put('personal', 'wechat-binding', {
              ...latest,
              version: latest.version + 1,
              last_error:
                status === 'failed' && newCredits > 0
                  ? '上一次提醒发送失败；已保留新申请的订阅权限。'
                  : error,
              ...(status === 'failed' ? { available: newCredits } : {}),
            });
          }
        });
      }
    } finally {
      this.ticking = false;
    }
  }
}
