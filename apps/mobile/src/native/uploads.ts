import { Platform } from 'react-native';
import type { ApiClient } from '../api/client';
import type { LocalAttachment } from './images';
import type { PendingInput } from '../storage/outbox';
export async function uploadLocal(api: ApiClient, file: LocalAttachment) {
  if (file.asset_id) return { id: file.asset_id };
  const form = new FormData();
  if (Platform.OS === 'web') {
    form.append('file', await (await fetch(file.uri)).blob(), file.name);
  } else
    form.append('file', {
      uri: file.uri,
      name: file.name,
      type: file.mime_type,
    } as any);
  return (
    await api.request(
      'POST',
      file.kind === 'image' ? '/media/images' : '/media/audio',
      form,
      { idempotency_key: file.idempotency_key, timeout_ms: 30000 },
    )
  ).data;
}
export async function prepareAttachments(api: ApiClient, item: PendingInput) {
  const attachments: LocalAttachment[] = [];
  for (const file of item.local_attachments) {
    const asset = await uploadLocal(api, file);
    attachments.push({ ...file, asset_id: asset.id });
  }
  return {
    ...item,
    local_attachments: attachments,
    body: {
      ...item.body,
      attachment_ids: [
        ...new Set([
          ...(item.body.attachment_ids ?? []),
          ...attachments.map((f) => f.asset_id!),
        ]),
      ],
    },
  };
}
