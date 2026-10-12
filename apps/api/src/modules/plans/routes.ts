import type { FitMindApp } from '../../app.js';
import {
  Type,
  PlanDraftSchema,
  DayInputSchema,
  WeeklyPlanSchema,
  RepeatPlanSchema,
  ProposalConfirmationSchema,
} from '@fitmind/contracts';
import { versionBody } from '../foundation-routes.js';
export function planRoutes(app: FitMindApp) {
  const { services: s, ctx, wrap } = app;
  app.get('/api/v1/plans', async (req) => wrap(req, s.plans.list('personal')));
  app.get('/api/v1/plans/:id', async (req) =>
    wrap(req, s.plans.get('personal', (req.params as any).id)),
  );
  app.post(
    '/api/v1/plans/drafts',
    { schema: { body: PlanDraftSchema } },
    async (req) => wrap(req, await s.plans.createDraft(ctx(req), req.body)),
  );
  for (const action of ['confirm', 'cancel'])
    app.post(
      '/api/v1/plans/:id/' + action,
      {
        schema: {
          body: action === 'confirm' ? ProposalConfirmationSchema : versionBody,
        },
      },
      async (req) =>
        wrap(
          req,
          await (action === 'confirm'
            ? s.plans.confirm(
                ctx(req),
                (req.params as any).id,
                (req.body as any).expected_version,
                (req.body as any).apply_from,
              )
            : s.plans.cancel(
                ctx(req),
                (req.params as any).id,
                (req.body as any).expected_version,
              )),
        ),
    );
  app.patch(
    '/api/v1/plans/:id',
    {
      schema: {
        body: Type.Object(
          {
            expected_version: Type.Integer({ minimum: 1 }),
            patch: Type.Object(
              {
                name: Type.Optional(Type.String()),
                days: Type.Optional(Type.Array(DayInputSchema)),
                weekly: Type.Optional(WeeklyPlanSchema),
                repeat: Type.Optional(RepeatPlanSchema),
              },
              { additionalProperties: false },
            ),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req) =>
      wrap(
        req,
        await s.plans.revise(
          ctx(req),
          (req.params as any).id,
          (req.body as any).expected_version,
          (req.body as any).patch,
        ),
      ),
  );
  app.get('/api/v1/workout-days', async (req) =>
    wrap(req, s.plans.days('personal')),
  );
  app.get('/api/v1/workout-days/:id', async (req) =>
    wrap(req, s.plans.getDay('personal', (req.params as any).id)),
  );
  app.get('/api/v1/reminders', async (req) =>
    wrap(req, await s.reminders.list('personal')),
  );
  app.post(
    '/api/v1/reminders/device-status',
    {
      schema: {
        body: Type.Object(
          {
            permission: Type.String(),
            scheduled: Type.Array(Type.String()),
            cancelled: Type.Array(Type.String()),
            failed: Type.Array(Type.String()),
            deferred: Type.Integer({ minimum: 0 }),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req) =>
      wrap(req, await s.reminders.reportDeviceStatus(ctx(req), req.body)),
  );
}
