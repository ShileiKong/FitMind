import type { FitMindApp } from '../app.js';
import {
  Type,
  TargetDraftSchema,
  ProfilePatchSchema,
  ProposalConfirmationSchema,
} from '@fitmind/contracts';
import { getTimeContext } from './time/service.js';
export const versionBody = Type.Object(
  { expected_version: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);
export function foundationRoutes(app: FitMindApp) {
  const { services: s, wrap, ctx } = app;
  app.get('/api/v1/profile', async (req) =>
    wrap(req, s.profile.get('personal')),
  );
  app.patch(
    '/api/v1/profile',
    { schema: { body: ProfilePatchSchema } },
    async (req) => {
      // A replacement timezone must allow repair of legacy corrupt configuration.
      const patch = req.body as any;
      const command = ctx(req, patch.timezone);
      return wrap(req, await s.profile.update(command, patch));
    },
  );
  app.get('/api/v1/targets', async (req) =>
    wrap(req, s.targets.list('personal')),
  );
  app.post(
    '/api/v1/targets/drafts',
    { schema: { body: TargetDraftSchema } },
    async (req) => wrap(req, await s.targets.draft(ctx(req), req.body)),
  );
  app.post(
    '/api/v1/targets/:id/confirm',
    { schema: { body: ProposalConfirmationSchema } },
    async (req) =>
      wrap(
        req,
        await s.targets.confirm(
          ctx(req),
          (req.params as any).id,
          (req.body as any).expected_version,
          (req.body as any).apply_from,
        ),
      ),
  );
  app.get('/api/v1/days/:date/summary', async (req) =>
    wrap(req, await s.summary.forDate('personal', (req.params as any).date)),
  );
  app.get('/api/v1/trends', async (req) =>
    wrap(req, await s.trends.query('personal', req.query)),
  );
}
