import { Type, DateSchema, NullableNumber, type Static } from './common.js';
export const ExerciseSchema = Type.Object(
  {
    exercise_id: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    variant: Type.String(),
    equipment: Type.String(),
    load_convention: Type.Union([
      Type.Literal('total'),
      Type.Literal('per_hand'),
      Type.Literal('bodyweight'),
      Type.Literal('machine'),
    ]),
    weight_kg: NullableNumber,
    increment_kg: NullableNumber,
    sets: Type.Integer({ minimum: 1, maximum: 30 }),
    reps_min: Type.Integer({ minimum: 1, maximum: 200 }),
    reps_max: Type.Integer({ minimum: 1, maximum: 200 }),
    rest_seconds: Type.Integer({ minimum: 0, maximum: 3600 }),
  },
  { additionalProperties: false },
);
export type ExercisePrescription = Static<typeof ExerciseSchema>;
export const DayInputSchema = Type.Object(
  {
    id: Type.Optional(Type.String()),
    local_date: DateSchema,
    name: Type.String({ minLength: 1 }),
    exercises: Type.Array(ExerciseSchema, { minItems: 1, maxItems: 30 }),
  },
  { additionalProperties: false },
);
export const RepeatPlanSchema = Type.Object(
  {
    start_date: DateSchema,
    end_date: DateSchema,
    weekdays: Type.Array(Type.Integer({ minimum: 0, maximum: 6 }), {
      minItems: 1,
    }),
    name: Type.String(),
    exercises: Type.Array(ExerciseSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);
export const WeeklyPlanSchema = Type.Object(
  {
    start_date: DateSchema,
    end_date: DateSchema,
    days: Type.Array(
      Type.Object(
        {
          weekday: Type.Integer({ minimum: 0, maximum: 6 }),
          name: Type.String({ minLength: 1 }),
          exercises: Type.Array(ExerciseSchema, { minItems: 1, maxItems: 30 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 7 },
    ),
  },
  { additionalProperties: false },
);
export const PlanDraftSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 200 }),
    days: Type.Optional(
      Type.Array(DayInputSchema, { minItems: 1, maxItems: 366 }),
    ),
    repeat: Type.Optional(RepeatPlanSchema),
    weekly: Type.Optional(WeeklyPlanSchema),
  },
  { additionalProperties: false },
);
export type PlanDraftInput = Static<typeof PlanDraftSchema>;
export type WorkoutDay = Static<typeof DayInputSchema> & {
  id: string;
  plan_id: string;
  plan_version: number;
  status: 'draft' | 'active' | 'cancelled';
};
export type PlanView = {
  id: string;
  version: number;
  name: string;
  status: 'draft' | 'active' | 'cancelled';
  days: WorkoutDay[];
  period?: { start_date: string; end_date: string };
  created_at: string;
};
export interface ReminderSpec {
  workout_day_id: string;
  plan_version: number;
  fire_at_utc: string;
  training_date: string;
  timezone: string;
  title: string;
  body: string;
}
