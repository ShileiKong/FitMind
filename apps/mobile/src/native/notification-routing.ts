import type { ApiClient } from '../api/client';
export async function handleResponse(api: ApiClient, payload: any) {
  if (typeof payload.workout_day_id !== 'string')
    throw new Error('提醒缺少训练日编号');
  const day = (
    await api.request(
      'GET',
      '/workout-days/' + encodeURIComponent(payload.workout_day_id),
    )
  ).data;
  return {
    day_id: day.id,
    plan_id: day.plan_id,
    status: day.status,
    plan_version: day.plan_version,
  };
}
