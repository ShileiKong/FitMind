import { readFileSync } from 'node:fs';
import { DomainError, invariant } from '../http/errors.js';
export class TranscriptionAdapter {
  async transcribe(input: any, signal: AbortSignal) {
    const key = process.env.TRANSCRIPTION_API_KEY;
    const model = process.env.TRANSCRIPTION_MODEL;
    invariant(
      key && model,
      'TRANSCRIPTION_UNCONFIGURED',
      '请配置语音转写 API 和模型',
      503,
    );
    const form = new FormData();
    form.append('model', model);
    form.append(
      'file',
      new Blob([readFileSync(input.path)], { type: input.mime_type }),
      input.id + '.' + input.extension,
    );
    form.append('response_format', 'json');
    const base = (
      process.env.TRANSCRIPTION_BASE_URL || 'https://api.openai.com/v1'
    ).replace(/\/$/, '');
    const res = await fetch(base + '/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key },
      body: form,
      signal,
    });
    if (!res.ok)
      throw new DomainError(
        'TRANSCRIPTION_FAILED',
        '语音转写失败（HTTP ' + res.status + '）',
        502,
        true,
      );
    const result: any = await res.json();
    invariant(
      typeof result.text === 'string',
      'TRANSCRIPTION_FORMAT',
      '转写结果格式无效',
      502,
    );
    return { text: result.text };
  }
}
