import type { FitMindApp } from '../../app.js';
import { AnalysisRequestSchema, Type } from '@fitmind/contracts';
import { invariant } from '../../http/errors.js';
export function mediaRoutes(app: FitMindApp) {
  const { services: s, ctx, wrap } = app;
  for (const [url, kind] of [
    ['/media/images', 'image'],
    ['/media/audio', 'audio'],
  ])
    app.post('/api/v1' + url, async (req) => {
      const file = await req.file();
      invariant(file, 'FILE_REQUIRED', '请选择文件');
      const buffer = await file.toBuffer();
      return wrap(
        req,
        await s.media.upload(ctx(req), {
          buffer,
          mimetype: file.mimetype,
          kind,
        }),
      );
    });
  app.get('/api/v1/media/:id', async (req, reply) => {
    const m = s.media.readOwned('personal', (req.params as any).id);
    return reply
      .type(m.mime_type)
      .header('Cache-Control', 'private, max-age=3600')
      .send((await import('node:fs')).readFileSync(m.path));
  });
  app.post(
    '/api/v1/nutrition/analyze',
    { schema: { body: AnalysisRequestSchema } },
    async (req) => wrap(req, await s.nutrition.analyze(ctx(req), req.body)),
  );
  app.post('/api/v1/audio/transcriptions', async (req) => {
    let asset_id = (req.body as any)?.asset_id;
    if (req.isMultipart()) {
      const file = await req.file();
      invariant(file, 'FILE_REQUIRED', '请选择录音文件');
      const asset = await s.media.upload(ctx(req), {
        buffer: await file.toBuffer(),
        mimetype: file.mimetype,
        kind: 'audio',
      });
      asset_id = asset.id;
    }
    invariant(
      typeof asset_id === 'string',
      'ASSET_REQUIRED',
      '请选择已上传录音',
    );
    return wrap(req, await s.media.transcribe(ctx(req), asset_id));
  });
}
