import type { FastifyRequest } from 'fastify';
import type { Clock, CommandContext } from '@fitmind/contracts';
import { getTimeContext } from '../modules/time/service.js';
export function requestContext(
  req: FastifyRequest,
  clock: Clock,
  timezone = 'Asia/Shanghai',
): CommandContext {
  const t = getTimeContext(clock, timezone);
  return {
    user_id: 'personal',
    request_id: req.id,
    idempotency_key: String(req.headers['idempotency-key'] ?? ''),
    now_utc: t.now_utc,
    timezone,
    reference_local_date: t.local_date,
  };
}
