type Submit = (
  path: string,
  body: any,
  method: string,
  key: string,
  attachments?: any[],
) => Promise<any>;
/** One form submission stays frozen until its caller consumes the receipt. */
export class SubmissionIntent {
  private intent: {
    key: string;
    signature: string;
    path: string;
    body: any;
    method: string;
    attachments: any[];
  } | null = null;
  private running: Promise<any> | null = null;
  constructor(private uuid: () => string) {}
  get key() {
    return this.intent?.key;
  }
  async run(
    submit: Submit,
    path: string,
    body: any,
    method = 'POST',
    attachments: any[] = [],
  ) {
    const { expected_version: _version, ...content } = body ?? {};
    // Polling can advance the cursor/version while the original request is awaiting a receipt.
    if (path.endsWith('/sets')) delete content.exercise_id;
    const signature = JSON.stringify({
      path,
      body: content,
      method,
      attachments,
    });
    if (this.intent && this.intent.signature !== signature)
      throw new Error(
        '原提交尚未核对回执，请先恢复原输入重试，或在待同步页核对后返回列表；避免重复记账',
      );
    this.intent ??= {
      key: this.uuid(),
      signature,
      path,
      method,
      body: JSON.parse(JSON.stringify(body)),
      attachments: JSON.parse(JSON.stringify(attachments)),
    };
    if (this.running) return this.running;
    const i = this.intent;
    this.running = submit(i.path, i.body, i.method, i.key, i.attachments);
    try {
      return await this.running;
    } finally {
      this.running = null;
    }
  }
  complete() {
    this.intent = null;
  }
}
