import type { FitMindApp } from '../../app.js';
import { Type } from '@fitmind/contracts';
import { WechatService, wechatOptions } from './service.js';
export function wechatRoutes(app: FitMindApp) {
  const service = new WechatService(app, app.deps.wechat ?? wechatOptions());
  app.services.wechat = service;
  app.get('/api/v1/wechat/config', async (req) =>
    app.wrap(req, service.config()),
  );
  app.post(
    '/api/v1/wechat/pair',
    {
      schema: {
        body: Type.Object(
          { code: Type.String({ minLength: 1, maxLength: 200 }) },
          { additionalProperties: false },
        ),
      },
    },
    async (req) =>
      app.wrap(req, await service.pair(app.ctx(req), req.body as any)),
  );
  app.post(
    '/api/v1/wechat/subscriptions',
    {
      schema: {
        body: Type.Object(
          {
            template_id: Type.String({ minLength: 1, maxLength: 200 }),
            accepted: Type.Boolean(),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req) =>
      app.wrap(req, service.subscribe(app.ctx(req), req.body as any)),
  );
  let timer: ReturnType<typeof setInterval> | undefined;
  app.addHook('onReady', async () => {
    if (service.config().enabled) {
      timer = setInterval(() => void service.tick().catch(() => {}), 15000);
      timer.unref();
    }
  });
  app.addHook('onClose', async () => {
    if (timer) clearInterval(timer);
  });
}
