import { Type, type Static } from './common.js';
export const ChatRequestSchema = Type.Object(
  {
    message_id: Type.String({ minLength: 1, maxLength: 100 }),
    conversation_id: Type.String({ minLength: 1, maxLength: 100 }),
    text: Type.String({ minLength: 1, maxLength: 10000 }),
    attachment_ids: Type.Optional(Type.Array(Type.String(), { maxItems: 3 })),
    workout_session_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    workout_exercise_id: Type.Optional(
      Type.Union([Type.String(), Type.Null()]),
    ),
    offline_queued: Type.Optional(Type.Boolean()),
    captured_at: Type.Optional(Type.String({ format: 'date-time' })),
    capture_timezone: Type.Optional(Type.String()),
    capture_local_date: Type.Optional(Type.String()),
    confirmation: Type.Optional(
      Type.Object(
        {
          type: Type.Union([Type.Literal('target'), Type.Literal('plan')]),
          id: Type.String(),
          expected_version: Type.Integer(),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type ChatRequest = Static<typeof ChatRequestSchema>;
export interface ChatResult {
  message_id: string;
  status: 'completed' | 'partial' | 'failed';
  assistant_text: string;
  record_receipts: any[];
  proposals: any[];
  recommendations: any[];
  affected_dates: string[];
  summary: any;
  tool_errors: any[];
  error?: { code: string; message: string; retryable: boolean };
}
