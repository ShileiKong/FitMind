import type { FitMindApp } from '../../app.js';
import { ChatRequestSchema, MemoryInputSchema, Type } from '@fitmind/contracts';
import { providerCapabilities } from '../../providers/factory.js';
import { versionBody } from '../foundation-routes.js';
export function agentRoutes(app: FitMindApp) {
  const { services: s, ctx, wrap } = app;
  app.get('/api/v1/capabilities', async (req) =>
    wrap(req, providerCapabilities()),
  );
  app.post(
    '/api/v1/chat',
    { schema: { body: ChatRequestSchema } },
    async (req) => wrap(req, await s.agent.submit(ctx(req), req.body)),
  );
  app.get('/api/v1/messages', async (req) =>
    wrap(
      req,
      s.agent.list('personal', (req.query as any).conversation_id ?? 'main'),
    ),
  );
  app.get('/api/v1/messages/:id', async (req) =>
    wrap(req, s.agent.get('personal', (req.params as any).id)),
  );
  app.post('/api/v1/messages/:id/recover', async (req) =>
    wrap(req, await s.agent.recover(ctx(req), (req.params as any).id)),
  );
  app.get('/api/v1/memories', async (req) =>
    wrap(req, s.memory.list('personal')),
  );
  app.post(
    '/api/v1/memories',
    { schema: { body: MemoryInputSchema } },
    async (req) => wrap(req, await s.memory.remember(ctx(req), req.body)),
  );
  app.patch(
    '/api/v1/memories/:id',
    {
      schema: {
        body: Type.Object(
          {
            expected_version: Type.Integer({ minimum: 1 }),
            value: Type.String({ minLength: 1 }),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req) =>
      wrap(
        req,
        await s.memory.revise(
          ctx(req),
          (req.params as any).id,
          (req.body as any).expected_version,
          (req.body as any).value,
        ),
      ),
  );
  app.post(
    '/api/v1/memories/:id/forget',
    { schema: { body: versionBody } },
    async (req) =>
      wrap(
        req,
        await s.memory.forget(
          ctx(req),
          (req.params as any).id,
          (req.body as any).expected_version,
        ),
      ),
  );
}
