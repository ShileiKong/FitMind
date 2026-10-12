import type { ApiClient } from '../api/client';
import type { NotificationAdapter } from './notifications';
export function reminderNotice(result: any): string {
  if (!result) return '';
  if (result.failed?.length)
    return `${result.failed.length} 项提醒同步失败，请在设置中重试`;
  if (result.permission === 'web_preview') return '网页预览不发送手机通知';
  if (result.permission !== 'granted') return '手机通知权限未开启';
  return `提醒已同步${result.deferred ? '，较远日期将在再次打开应用时安排' : ''}`;
}
export async function syncReminderStatus(
  api: ApiClient,
  adapter: NotificationAdapter,
  visible: (r: any) => void,
  report: boolean,
  uuid: () => string,
) {
  const specs = (await api.request('GET', '/reminders')).data;
  const result = await adapter.reconcile(specs);
  visible(result);
  if (report)
    await api.request('POST', '/reminders/device-status', result, {
      idempotency_key: uuid(),
    });
  return result;
}
