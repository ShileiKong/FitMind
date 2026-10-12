export function captureTime(timezone: string, now_utc: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(now_utc)
      .map((p) => [p.type, p.value]),
  );
  return {
    offline_queued: true,
    captured_at: now_utc.toISOString(),
    capture_timezone: timezone,
    capture_local_date: parts.year + '-' + parts.month + '-' + parts.day,
  };
}
