import type {
  Clock,
  TimeContext,
  DateReferenceInput,
} from '@fitmind/contracts';
import { invariant } from '../../http/errors.js';
export function validateDate(s: string) {
  invariant(
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
      !Number.isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
    'INVALID_DATE',
    '日期必须是有效 YYYY-MM-DD',
  );
  return s;
}
export function validateTimezone(s: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: s }).format();
  } catch {
    invariant(false, 'INVALID_TIMEZONE', '无效时区');
  }
  return s;
}
export function getTimeContext(clock: Clock, timezone: string): TimeContext {
  validateTimezone(timezone);
  const now = clock();
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => p.find((p) => p.type === type)!.value;
  return {
    now_utc: now.toISOString(),
    timezone,
    local_date: part('year') + '-' + part('month') + '-' + part('day'),
  };
}
export function resolveDate(expression: string, reference_date: string) {
  validateDate(reference_date);
  const offsets: Record<string, number> = {
    今天: 0,
    昨天: -1,
    前天: -2,
    明天: 1,
    后天: 2,
  };
  if (expression in offsets) {
    const d = new Date(reference_date + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + offsets[expression]);
    return d.toISOString().slice(0, 10);
  }
  return validateDate(expression);
}
export function resolveReferenceDate(
  input: DateReferenceInput,
  server: TimeContext,
) {
  if (!input.offline_queued) return server.local_date;
  invariant(
    input.captured_at && input.capture_timezone && input.capture_local_date,
    'CAPTURE_DATE_REQUIRED',
    '离线输入需要采集日期',
  );
  invariant(
    Number.isFinite(Date.parse(input.captured_at)),
    'INVALID_CAPTURE',
    '无效采集时间',
  );
  const captured = getTimeContext(
    () => new Date(input.captured_at!),
    input.capture_timezone,
  );
  invariant(
    captured.local_date === input.capture_local_date,
    'CAPTURE_DATE_MISMATCH',
    '请核对离线输入归属日期',
  );
  invariant(
    Date.parse(input.captured_at) <= Date.parse(server.now_utc) + 300000,
    'CLOCK_SKEW',
    '设备时间超前，请核对记录日期',
  );
  return validateDate(input.capture_local_date);
}
