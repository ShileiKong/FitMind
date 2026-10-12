import { it, expect } from 'vitest';
import { MediaDraftController } from '../src/state/media-drafts';
import { messageFingerprint } from '../src/state/message-fingerprint';
it('uploaded_asset_retains_same_message_identity', () => {
  expect(
    messageFingerprint('食物', {
      local_attachments: [{ idempotency_key: 'i', uri: 'a' }],
    }),
  ).toBe(
    messageFingerprint('食物', {
      local_attachments: [
        { idempotency_key: 'i', uri: 'a', asset_id: 'uploaded' },
      ],
    }),
  );
});
it('failed_upload_preserves_draft', async () => {
  const m = new MediaDraftController({
    upload: async () => {
      throw new Error('offline');
    },
    transcribe: async () => ({ text: '' }),
  });
  await expect(m.upload({ uri: 'local.jpg', kind: 'image' })).rejects.toThrow();
  expect(m.draft.uri).toBe('local.jpg');
});
it('permission_denial_allows_text', async () => {
  const m = new MediaDraftController({
    permission: async () => false,
    upload: async () => ({}),
    transcribe: async () => ({ text: '' }),
  });
  expect(await m.canCapture()).toBe(false);
  expect(m.textEnabled).toBe(true);
});
it('transcription_requires_user_send', async () => {
  let writes = 0;
  const m = new MediaDraftController({
    upload: async () => ({ id: 'audio' }),
    transcribe: async () => ({ text: '喝了 300ml 水' }),
    record: async () => {
      writes++;
    },
  });
  await m.transcribe({ uri: 'local.m4a', kind: 'audio' });
  expect(m.text).toBe('喝了 300ml 水');
  expect(writes).toBe(0);
});
