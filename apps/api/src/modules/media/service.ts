import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { CommandContext, MediaAsset } from '@fitmind/contracts';
import { Store } from '../../db/store.js';
import { invariant } from '../../http/errors.js';
const mimeExtensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'video/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'video/webm': 'webm',
};
function signature(b: Buffer, mime: string) {
  if (mime === 'image/png')
    return b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  if (mime === 'image/jpeg')
    return b[0] === 255 && b[1] === 216 && b[2] === 255;
  if (mime === 'image/webp')
    return (
      b.toString('ascii', 0, 4) === 'RIFF' &&
      b.toString('ascii', 8, 12) === 'WEBP'
    );
  if (mime.includes('wav'))
    return (
      b.toString('ascii', 0, 4) === 'RIFF' &&
      b.toString('ascii', 8, 12) === 'WAVE'
    );
  if (mime.includes('webm'))
    return b.subarray(0, 4).toString('hex') === '1a45dfa3';
  if (mime.includes('mp4') || mime.includes('m4a'))
    return b.toString('ascii', 4, 8) === 'ftyp';
  return (
    b.toString('ascii', 0, 3) === 'ID3' ||
    (b[0] === 255 && (b[1] & 224) === 224)
  );
}
export class MediaService {
  constructor(
    private store: Store,
    private root: string,
    private transcription: any,
  ) {
    mkdirSync(root, { recursive: true });
  }
  async upload(ctx: CommandContext, file: any): Promise<MediaAsset> {
    invariant(
      ['image', 'audio'].includes(file.kind),
      'INVALID_MEDIA',
      '附件类型无效',
    );
    const b: Buffer = file.buffer;
    invariant(Buffer.isBuffer(b) && b.length > 0, 'EMPTY_FILE', '文件为空');
    invariant(
      b.length <= (file.kind === 'image' ? 10 : 20) * 1024 * 1024,
      'FILE_TOO_LARGE',
      '图片最多 10MiB，音频最多 20MiB',
      413,
    );
    const ext = mimeExtensions[file.mimetype];
    invariant(
      ext &&
        (file.kind === 'image'
          ? file.mimetype.startsWith('image/')
          : !file.mimetype.startsWith('image/')) &&
        signature(b, file.mimetype),
      'INVALID_MEDIA',
      '文件格式不支持或与内容不一致',
    );
    const input = {
      kind: file.kind,
      mime: file.mimetype,
      hash: createHash('sha256').update(b).digest('hex'),
    };
    return this.store.mutate(ctx, 'media.upload', input, () => {
      const id = this.store.id(),
        path = resolve(this.root, id + '.' + ext);
      writeFileSync(path, b);
      const m = {
        id,
        kind: file.kind,
        mime_type: file.mimetype,
        size_bytes: b.length,
        created_at: ctx.now_utc,
        version: 1,
        path,
        extension: ext,
      };
      this.store.put(ctx.user_id, 'media', m);
      const { path: _, extension: __, ...publicAsset } = m;
      return publicAsset;
    });
  }
  readOwned(user: string, id: string) {
    return this.store.get<any>(user, 'media', id);
  }
  imageData(user: string, id: string) {
    const m = this.readOwned(user, id);
    invariant(m.kind === 'image', 'NOT_IMAGE', '需要图片附件');
    return (
      'data:' +
      m.mime_type +
      ';base64,' +
      readFileSync(m.path).toString('base64')
    );
  }
  async transcribe(ctx: CommandContext, id: string) {
    const m = this.readOwned(ctx.user_id, id);
    invariant(m.kind === 'audio', 'NOT_AUDIO', '需要录音附件');
    const result = await this.transcription.transcribe(
      m,
      AbortSignal.timeout(30000),
    );
    invariant(
      typeof result.text === 'string',
      'INVALID_TRANSCRIPT',
      '转写结果无效',
    );
    return { asset_id: id, text: result.text };
  }
}
