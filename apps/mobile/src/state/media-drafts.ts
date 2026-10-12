export class MediaDraftController {
  draft: any;
  text = '';
  textEnabled = true;
  constructor(private port: any) {}
  async upload(item: any) {
    this.draft = item;
    return this.port.upload(item);
  }
  async canCapture() {
    return !!(await this.port.permission?.());
  }
  async transcribe(item: any) {
    const asset = await this.upload(item);
    const result = await this.port.transcribe(asset);
    this.text = result.text;
    return result;
  }
}
