import Fastify, { type FastifyInstance, type RouteOptions } from 'fastify';
import cors from '@fastify/cors';
import { timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Clock } from '@fitmind/contracts';
import { RecordInputSchema, Type } from '@fitmind/contracts';
import { Store } from './db/store.js';
import { migrate } from './db/database.js';
import { RecordService } from './modules/records/service.js';
import { DomainError } from './http/errors.js';
import { requestContext } from './http/context.js';
import { getTimeContext } from './modules/time/service.js';
import { registerOpenApi, registerPublicAliases } from './http/openapi.js';
import { TargetService } from './modules/targets/service.js';
import { SummaryService } from './modules/summary/service.js';
import { ProfileService } from './modules/profile/service.js';
import { TrendService } from './modules/trends/service.js';
import { foundationRoutes } from './modules/foundation-routes.js';
import { PlanService } from './modules/plans/service.js';
import { ReminderService } from './modules/reminders/service.js';
import { planRoutes } from './modules/plans/routes.js';
import { wechatRoutes } from './modules/wechat/routes.js';
import type { WechatOptions } from './modules/wechat/service.js';
export interface AppDependencies {
  db: DatabaseSync;
  clock: Clock;
  access_token: string;
  media_root: string;
  providers?: any;
  wechat?: WechatOptions;
}
import { WorkoutService } from './modules/workouts/service.js';
import { workoutRoutes } from './modules/workouts/routes.js';
import { MemoryService } from './modules/memory/service.js';
import { AgentRunner } from './modules/agent/runner.js';
import { createTextProvider } from './providers/factory.js';
import { agentRoutes } from './modules/agent/routes.js';
import multipart from '@fastify/multipart';
import { MediaService } from './modules/media/service.js';
import { NutritionAnalyzer } from './modules/nutrition/analyze.js';
import { VisionAdapter } from './providers/vision.js';
import { TranscriptionAdapter } from './providers/transcription.js';
import { mediaRoutes } from './modules/media/routes.js';
export type FitMindApp = FastifyInstance & {
  services: Record<string, any>;
  store: Store;
  deps: AppDependencies;
  wrap: (req: any, data: any) => any;
  ctx: (req: any, timezone?: string) => any;
};
export async function createApp(deps: AppDependencies): Promise<FitMindApp> {
  migrate(deps.db);
  const app = Fastify({
    logger: false,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  await registerOpenApi(app);
  const capturedRoutes: RouteOptions[] = [];
  app.addHook('onRoute', (r) => {
    capturedRoutes.push(r);
  });
  const store = new Store(deps.db);
  const targets = new TargetService(store);
  const profile = new ProfileService(store);
  const services = {
    records: new RecordService(store),
    targets,
    profile,
    summary: new SummaryService(store, targets),
    trends: new TrendService(store),
  };
  app.decorate('services', services);
  await app.register(cors, {
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    origin: (origin, cb) =>
      cb(
        null,
        !origin ||
          /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)(:\d+)?$/.test(
            origin,
          ),
      ),
  });
  app.addHook('preHandler', async (req) => {
    if (req.url.split('?')[0] === '/api/v1/health') return;
    const supplied = Buffer.from(
      String(req.headers.authorization ?? '').replace(/^Bearer /, ''),
    );
    const expected = Buffer.from(deps.access_token);
    if (
      !expected.length ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      throw new DomainError('UNAUTHORIZED', '请输入个人访问令牌', 401);
  });
  app.setErrorHandler((error, req, reply) => {
    const e = error as any;
    reply.status(e.status ?? e.statusCode ?? 500).send({
      error: {
        code: e.code ?? 'INTERNAL_ERROR',
        message: e.validation
          ? '输入格式不正确'
          : e.status || (e.statusCode && e.statusCode < 500)
            ? e.message
            : '服务暂时不可用',
        retryable: e.retryable ?? false,
      },
      request_id: req.id,
    });
  });
  const wrap = (req: any, data: any) => ({
    data,
    request_id: req.id,
    server_time: deps.clock().toISOString(),
    timezone: profile.get('personal').timezone,
  });
  const ctx = (req: any, timezone?: string) =>
    requestContext(
      req,
      deps.clock,
      timezone ?? profile.get('personal').timezone,
    );
  app.get('/api/v1/health', async (req) => wrap(req, { status: 'ok' }));
  app.get('/api/v1/context', async (req) =>
    wrap(req, {
      ...getTimeContext(deps.clock, profile.get('personal').timezone),
      target: targets.forDate(
        'personal',
        getTimeContext(deps.clock, profile.get('personal').timezone).local_date,
      ),
      active_workout:
        enhanced.services.workouts
          .list('personal')
          .find((w: any) => ['active', 'paused'].includes(w.status)) ?? null,
    }),
  );
  app.get('/api/v1/records', async (req) =>
    wrap(req, await services.records.list('personal', req.query)),
  );
  app.get('/api/v1/records/:id', async (req) =>
    wrap(req, store.get('personal', 'record', (req.params as any).id)),
  );
  app.post(
    '/api/v1/records',
    { schema: { body: RecordInputSchema } },
    async (req) =>
      wrap(req, await services.records.create(ctx(req), req.body as any)),
  );
  app.patch(
    '/api/v1/records/:id',
    {
      schema: {
        body: Type.Object(
          {
            expected_version: Type.Integer({ minimum: 1 }),
            patch: Type.Record(Type.String(), Type.Unknown()),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req) => {
      const b = req.body as any;
      return wrap(
        req,
        await services.records.edit(
          ctx(req),
          (req.params as any).id,
          b.expected_version,
          b.patch,
        ),
      );
    },
  );
  app.post(
    '/api/v1/records/:id/undo',
    {
      schema: {
        body: Type.Object(
          { expected_version: Type.Integer({ minimum: 1 }) },
          { additionalProperties: false },
        ),
      },
    },
    async (req) =>
      wrap(
        req,
        await services.records.undo(
          ctx(req),
          (req.params as any).id,
          (req.body as any).expected_version,
        ),
      ),
  );
  // Fastify is thenable; its built-in then() type omits custom decorators.
  await app.register(multipart, {
    limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 5 },
  });
  const enhanced = Object.assign(app, {
    services,
    store,
    deps,
    wrap,
    ctx,
  }) as FitMindApp;
  enhanced.services.plans = new PlanService(store);
  enhanced.services.reminders = new ReminderService(
    store,
    enhanced.services.plans,
    profile,
    deps.clock,
  );
  enhanced.services.workouts = new WorkoutService(
    store,
    enhanced.services.plans,
  );
  enhanced.services.media = new MediaService(
    store,
    deps.media_root,
    deps.providers?.transcription ?? new TranscriptionAdapter(),
  );
  enhanced.services.nutrition = new NutritionAnalyzer(
    enhanced.services.media,
    deps.providers?.vision ?? new VisionAdapter(),
  );
  enhanced.services.memory = new MemoryService(
    store,
    enhanced.services,
    deps.clock,
  );
  enhanced.services.agent = new AgentRunner(
    enhanced,
    deps.providers?.text ?? createTextProvider(),
  );
  foundationRoutes(enhanced);
  planRoutes(enhanced);
  workoutRoutes(enhanced);
  agentRoutes(enhanced);
  mediaRoutes(enhanced);
  wechatRoutes(enhanced);
  registerPublicAliases(app, capturedRoutes);
  app.get('/api/v1/openapi.json', async () => app.swagger());
  app.get('/api/v1/chat/conversations/:id/messages', async (req) =>
    wrap(req, enhanced.services.agent.list('personal', (req.params as any).id)),
  );
  app.get('/api/v1/workout-sessions/:id/recommendations', async (req) =>
    wrap(
      req,
      enhanced.services.workouts.recommendations(
        'personal',
        (req.params as any).id,
      ),
    ),
  );
  return enhanced as any;
}
