export function messageFingerprint(text: string, extra: any = {}) {
  return JSON.stringify({
    text,
    attachment_ids: extra.attachment_ids ?? [],
    local_attachments: (extra.local_attachments ?? []).map(
      (a: any) => a.idempotency_key,
    ),
    confirmation: extra.confirmation ?? null,
  });
}
