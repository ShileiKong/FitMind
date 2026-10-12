import { it, expect, afterEach } from 'vitest';
import { makeHarness } from './helpers.js';
let h: any;
afterEach(async () => {
  if (h) await h.close();
  h = null;
});
const png = Buffer.from('89504e470d0a1a0a', 'hex');
it('image_owner_checked', async () => {
  h = await makeHarness();
  const m = await h.services.media.upload(h.ctx, {
    buffer: png,
    mimetype: 'image/png',
    kind: 'image',
  });
  expect(() => h.services.media.readOwned('stranger', m.id)).toThrow();
});
it('oversize_upload_is_rejected', async () => {
  h = await makeHarness();
  await expect(
    h.services.media.upload(h.ctx, {
      buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
      mimetype: 'image/png',
      kind: 'image',
    }),
  ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
});
it('audio_returns_text_without_record', async () => {
  h = await makeHarness({
    providers: {
      transcription: {
        transcribe: async () => ({ text: '我喝了 300 毫升水' }),
      },
    },
  });
  const wav = Buffer.concat([Buffer.from('RIFF0000WAVE'), Buffer.alloc(8)]);
  const m = await h.services.media.upload(h.ctx, {
    buffer: wav,
    mimetype: 'audio/wav',
    kind: 'audio',
  });
  expect((await h.services.media.transcribe(h.ctx, m.id)).text).toContain(
    '300',
  );
  expect((await h.services.records.list('personal')).items).toEqual([]);
});
