export function dashboardClock(
  context: { now_utc: string },
  received_at: number,
) {
  return {
    server_time: context.now_utc,
    received_at,
    offset_ms: Date.parse(context.now_utc) - received_at,
  };
}
