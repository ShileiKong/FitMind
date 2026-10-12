import swagger from '@fastify/swagger';
import type { FastifyInstance, RouteOptions } from 'fastify';
import { Type } from '@fitmind/contracts';
const envelope = Type.Object({
  data: Type.Unknown(),
  request_id: Type.String(),
  server_time: Type.String(),
  timezone: Type.String(),
});
const error = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    retryable: Type.Boolean(),
  }),
  request_id: Type.String(),
});
export async function registerOpenApi(app: FastifyInstance) {
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'FitMind personal Agent API',
        version: '1.0.0',
        description:
          'Single personal user; dates are YYYY-MM-DD, times UTC ISO 8601. Mutations are idempotent; edits require expected_version.',
      },
      components: {
        securitySchemes: { personalToken: { type: 'http', scheme: 'bearer' } },
      },
      security: [{ personalToken: [] }],
    },
    transformObject: (document) => {
      const spec = (
        'openapiObject' in document
          ? document.openapiObject
          : document.swaggerObject
      ) as any;
      for (const path of ['/api/v1/media/images', '/api/v1/media/audio']) {
        spec.paths[path].post.requestBody = {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: { file: { type: 'string', format: 'binary' } },
              },
            },
          },
        };
      }
      spec.paths['/api/v1/audio/transcriptions'].post.requestBody = {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['asset_id'],
              properties: { asset_id: { type: 'string' } },
              additionalProperties: false,
            },
          },
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['file'],
              properties: { file: { type: 'string', format: 'binary' } },
            },
          },
        },
      };
      return spec;
    },
  });
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    const mutation = methods.some((m) =>
      ['POST', 'PATCH', 'DELETE', 'PUT'].includes(m),
    );
    const health = route.url === '/api/v1/health';
    route.schema = {
      ...route.schema,
      tags: [route.url.split('/')[3] ?? 'system'],
      security: health ? [] : [{ personalToken: [] }],
      ...(mutation
        ? {
            headers: Type.Object(
              { 'Idempotency-Key': Type.String({ minLength: 1 }) },
              { additionalProperties: true },
            ),
          }
        : {}),
      response: route.url.includes('/media/:id')
        ? route.schema?.response
        : {
            200:
              route.url === '/api/v1/openapi.json' ? Type.Unknown() : envelope,
            400: error,
            401: error,
            404: error,
            409: error,
            500: error,
            503: error,
          },
    };
  });
}
// Keep routes already used by the app while exposing all paths promised in the specification.
export function registerPublicAliases(
  app: FastifyInstance,
  routes: RouteOptions[],
) {
  const aliases = [
    ['POST', '/targets/:id/confirm', '/targets/drafts/:id/confirm'],
    ['POST', '/chat', '/chat/messages'],
    ['GET', '/messages/:id', '/chat/messages/:id'],
    ['POST', '/plans/drafts', '/plans'],
    ['POST', '/workout-sessions/:id/transition', '/workout-sessions/:id'],
    ['POST', '/memories/:id/forget', '/memories/:id'],
  ] as const;
  for (const [method, source, target] of aliases) {
    const route = routes.find(
      (r) => r.url === '/api/v1' + source && r.method === method,
    )!;
    app.route({
      ...route,
      url: '/api/v1' + target,
      method:
        target === '/memories/:id'
          ? 'DELETE'
          : target === '/workout-sessions/:id'
            ? 'PATCH'
            : method,
    });
  }
}
