import { Type, DateSchema, NullableNumber, type Static } from './common.js';
export const TargetDraftSchema = Type.Object(
  {
    effective_from: DateSchema,
    effective_to: Type.Optional(Type.Union([DateSchema, Type.Null()])),
    allow_history: Type.Optional(Type.Boolean()),
    water_ml: NullableNumber,
    calories_kcal: NullableNumber,
    carbs_g: NullableNumber,
    protein_g: NullableNumber,
    fat_g: NullableNumber,
  },
  { additionalProperties: false },
);
export type TargetDraftInput = Static<typeof TargetDraftSchema>;
export type TargetView = TargetDraftInput & {
  id: string;
  version: number;
  status: 'draft' | 'active' | 'superseded';
  effective_to: string | null;
  created_at: string;
};
export interface Budget {
  target: number | null;
  known_total: number;
  remaining: number | null;
  over: number | null;
  estimated: boolean;
  incomplete: boolean;
}
export type DailySummary = {
  local_date: string;
  target_id: string | null;
  record_count: number;
} & Record<
  'water_ml' | 'calories_kcal' | 'carbs_g' | 'protein_g' | 'fat_g',
  Budget
>;
