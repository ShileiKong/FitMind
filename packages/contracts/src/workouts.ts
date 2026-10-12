import { Type, NullableNumber, DateSchema, type Static } from './common.js';
import type { WorkoutDay } from './plans.js';
export const SetInputSchema = Type.Object(
  {
    exercise_id: Type.String({ minLength: 1 }),
    weight_kg: Type.Optional(NullableNumber),
    reps: Type.Integer({ minimum: 0, maximum: 300 }),
    difficulty: Type.Optional(
      Type.Union([
        Type.Literal('easy'),
        Type.Literal('normal'),
        Type.Literal('hard'),
        Type.Null(),
      ]),
    ),
    rpe: Type.Optional(
      Type.Union([Type.Number({ minimum: 1, maximum: 10 }), Type.Null()]),
    ),
    pain: Type.Optional(Type.Boolean()),
    reduce: Type.Optional(Type.Boolean()),
    local_date: Type.Optional(DateSchema),
    occurred_at: Type.Optional(
      Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    ),
  },
  { additionalProperties: false },
);
export type WorkoutSetInput = Static<typeof SetInputSchema>;
export type WorkoutSet = WorkoutSetInput & {
  id: string;
  version: number;
  session_id: string;
  weight_kg: number | null;
  local_date: string;
  recorded_at: string;
  undone_at: string | null;
};
export interface WorkoutSession {
  id: string;
  version: number;
  workout_day_id: string;
  local_date: string;
  status: 'active' | 'paused' | 'completed' | 'abandoned';
  current_exercise_id: string;
  snapshot: WorkoutDay;
  started_at: string;
  finished_at: string | null;
  sets: WorkoutSet[];
}
export interface Recommendation {
  id?: string;
  version?: number;
  weight_kg: number | null;
  reps_min: number;
  reps_max: number;
  reason_code: string;
  basis: { id: string; version: number }[];
  rule_version: string;
  status: 'proposed' | 'paused' | 'accepted' | 'invalidated';
}
