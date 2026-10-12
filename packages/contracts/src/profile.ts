import { Type, type Static } from './common.js';
export const FitnessProfileSchema = Type.Object(
  {
    height_cm: Type.Optional(Type.Number({ minimum: 50, maximum: 260 })),
    weight_kg: Type.Optional(Type.Number({ minimum: 10, maximum: 400 })),
    sex: Type.Optional(
      Type.Union([
        Type.Literal('male'),
        Type.Literal('female'),
        Type.Literal('unspecified'),
      ]),
    ),
    goal: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
    strength_training: Type.Optional(
      Type.Union([
        Type.Literal('yes'),
        Type.Literal('no'),
        Type.Literal('unsure'),
      ]),
    ),
    availability_text: Type.Optional(
      Type.String({ minLength: 1, maxLength: 300 }),
    ),
    limitations: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    equipment: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  },
  { additionalProperties: false },
);
export type FitnessProfile = Static<typeof FitnessProfileSchema>;
export const OnboardingStatusSchema = Type.Union([
  Type.Literal('in_progress'),
  Type.Literal('completed'),
  Type.Literal('skipped'),
]);
export const ProfilePatchSchema = Type.Object(
  {
    expected_version: Type.Integer({ minimum: 0 }),
    name: Type.Optional(Type.String({ maxLength: 100 })),
    timezone: Type.Optional(Type.String({ minLength: 1 })),
    reminder_time: Type.Optional(
      Type.String({ pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' }),
    ),
    notifications_enabled: Type.Optional(Type.Boolean()),
    fitness: Type.Optional(FitnessProfileSchema),
    onboarding_status: Type.Optional(OnboardingStatusSchema),
  },
  { additionalProperties: false },
);
export type ProfilePatch = Static<typeof ProfilePatchSchema>;
export interface Profile {
  id: string;
  version: number;
  name: string;
  timezone: string;
  reminder_time: string;
  notifications_enabled: boolean;
  fitness?: FitnessProfile;
  onboarding_status?: Static<typeof OnboardingStatusSchema>;
}
