import type { ChatRequest, ChatResult, DailySummary } from '@fitmind/contracts';
import { ApiClient } from '../api/client';
export class TodayController {
  date = '';
  summary!: DailySummary;
  constructor(private api: ApiClient) {}
  async refresh(date?: string) {
    const time = (await this.api.request('GET', '/context')).data;
    this.date = date ?? time.local_date;
    this.summary = (
      await this.api.request<DailySummary>(
        'GET',
        '/days/' + this.date + '/summary',
      )
    ).data;
    return this.summary;
  }
  async applyReceipt(r: ChatResult) {
    if (r.affected_dates.includes(this.date)) await this.refresh(this.date);
  }
  async send(request: ChatRequest) {
    const r = (
      await this.api.request<ChatResult>('POST', '/chat', request, {
        idempotency_key: request.message_id,
      })
    ).data;
    await this.applyReceipt(r);
    return r;
  }
}
