import type { FitMindApp } from '../../app.js';
import { Type, SetInputSchema } from '@fitmind/contracts';
import { versionBody } from '../foundation-routes.js';
export function workoutRoutes(app: FitMindApp) {
  const { services: s, ctx, wrap } = app;
  app.get('/api/v1/workout-sessions', async (req) =>
    wrap(req, s.workouts.list('personal')),
  );
  app.get('/api/v1/workout-sessions/:id', async (req) =>
    wrap(req, s.workouts.get('personal', (req.params as any).id)),
  );
  app.post(
    '/api/v1/workout-sessions',
    {
      schema: {
        body: Type.Object(
          { workout_day_id: Type.String() },
          { additionalProperties: false },
        ),
      },
    },
    async (req) =>
      wrap(
        req,
        await s.workouts.start(ctx(req), (req.body as any).workout_day_id),
      ),
  );
  app.post(
    '/api/v1/workout-sessions/:id/transition',
    {
      schema: {
        body: Type.Object(
          {
            expected_version: Type.Integer({ minimum: 1 }),
            action: Type.Union(
              [
                'pause',
                'resume',
                'complete',
                'abandon',
                'switch',
                'skip',
                'change_date',
              ].map((x) => Type.Literal(x)),
            ),
            exercise_id: Type.Optional(Type.String()),
            local_date: Type.Optional(Type.String()),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req) =>
      wrap(
        req,
        await s.workouts.transition(
          ctx(req),
          (req.params as any).id,
          (req.body as any).expected_version,
          req.body,
        ),
      ),
  );
  app.post(
    '/api/v1/workout-sessions/:id/sets',
    { schema: { body: SetInputSchema } },
    async (req) =>
      wrap(
        req,
        await s.workouts.recordSet(ctx(req), (req.params as any).id, req.body),
      ),
  );
  app.patch(
    '/api/v1/workout-sets/:id',
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
    async (req) =>
      wrap(
        req,
        await s.workouts.editSet(
          ctx(req),
          (req.params as any).id,
          (req.body as any).expected_version,
          (req.body as any).patch,
        ),
      ),
  );
  app.post(
    '/api/v1/workout-sets/:id/undo',
    { schema: { body: versionBody } },
    async (req) =>
      wrap(
        req,
        await s.workouts.undoSet(
          ctx(req),
          (req.params as any).id,
          (req.body as any).expected_version,
        ),
      ),
  );
  app.get('/api/v1/recommendations', async (req) =>
    wrap(
      req,
      s.workouts.recommendations('personal', (req.query as any).session_id),
    ),
  );
  app.post(
    '/api/v1/recommendations/:id/accept',
    { schema: { body: versionBody } },
    async (req) =>
      wrap(
        req,
        await s.workouts.acceptRecommendation(
          ctx(req),
          (req.params as any).id,
          (req.body as any).expected_version,
        ),
      ),
  );
}
