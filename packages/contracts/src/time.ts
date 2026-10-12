export interface TimeContext {
  now_utc: string;
  timezone: string;
  local_date: string;
}
export interface DateReferenceInput {
  offline_queued?: boolean;
  captured_at?: string;
  capture_timezone?: string;
  capture_local_date?: string;
}
