import { Type, type Static } from 'typebox';
export const DateSchema = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' });
export const ProposalConfirmationSchema = Type.Object(
  {
    expected_version: Type.Integer({ minimum: 1 }),
    apply_from: Type.Optional(DateSchema),
  },
  { additionalProperties: false },
);
export type ProposalConfirmation = Static<typeof ProposalConfirmationSchema>;
export const NullableNumber = Type.Union([
  Type.Number({ minimum: 0 }),
  Type.Null(),
]);
export interface CommandContext {
  user_id: string;
  request_id: string;
  idempotency_key: string;
  now_utc: string;
  timezone: string;
  reference_local_date: string;
  source_message_id?: string;
  workout_session_id?: string | null;
  workout_exercise_id?: string | null;
}
export interface ApiEnvelope<T> {
  data: T;
  request_id: string;
  server_time: string;
  timezone: string;
}
export interface MutationResult<T> {
  entity: T;
  version: number;
  affected_dates: string[];
}
export type Clock = () => Date;
export { Type };
export type { Static };
