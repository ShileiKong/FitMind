import { Type, DateSchema, NullableNumber, type Static } from './common.js';
export const NutritionSchema = Type.Object(
  {
    calories_kcal: NullableNumber,
    carbs_g: NullableNumber,
    protein_g: NullableNumber,
    fat_g: NullableNumber,
  },
  { additionalProperties: false },
);
export type NutritionValues = Static<typeof NutritionSchema>;
const metadata = {
  local_date: Type.Optional(DateSchema),
  occurred_at: Type.Optional(
    Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  ),
  note: Type.Optional(Type.String({ maxLength: 2000 })),
};
export const WaterInputSchema = Type.Object(
  {
    kind: Type.Literal('water'),
    amount_ml: Type.Number({ exclusiveMinimum: 0, maximum: 20000 }),
    ...metadata,
  },
  { additionalProperties: false },
);
export const LabelSchema = Type.Object(
  {
    basis_quantity: Type.Number({ exclusiveMinimum: 0 }),
    basis_unit: Type.Union([
      Type.Literal('g'),
      Type.Literal('ml'),
      Type.Literal('serving'),
    ]),
    consumed_quantity: Type.Number({ exclusiveMinimum: 0 }),
    consumed_unit: Type.Union([
      Type.Literal('g'),
      Type.Literal('ml'),
      Type.Literal('serving'),
    ]),
    nutrition_per_basis: NutritionSchema,
  },
  { additionalProperties: false },
);
export const FoodInputSchema = Type.Object(
  {
    kind: Type.Literal('food'),
    name: Type.String({ minLength: 1, maxLength: 200 }),
    source: Type.Union([Type.Literal('label'), Type.Literal('estimate')]),
    nutrition: NutritionSchema,
    label: Type.Optional(Type.Union([LabelSchema, Type.Null()])),
    assumptions: Type.Optional(Type.String({ maxLength: 2000 })),
    attachment_ids: Type.Optional(Type.Array(Type.String())),
    ...metadata,
  },
  { additionalProperties: false },
);
export const BodyInputSchema = Type.Object(
  {
    kind: Type.Literal('body'),
    metric: Type.Union(
      [
        'weight_kg',
        'body_fat_percent',
        'waist_cm',
        'chest_cm',
        'hip_cm',
        'arm_cm',
      ].map((v) => Type.Literal(v)),
    ),
    value: Type.Number({ exclusiveMinimum: 0, maximum: 1000 }),
    ...metadata,
  },
  { additionalProperties: false },
);
export const RecordInputSchema = Type.Union([
  WaterInputSchema,
  FoodInputSchema,
  BodyInputSchema,
]);
export type RecordInput = Static<typeof RecordInputSchema>;
export type RecordView = RecordInput & {
  id: string;
  local_date: string;
  occurred_at: string | null;
  recorded_at: string;
  timezone: string;
  source_message_id: string | null;
  version: number;
  undone_at: string | null;
};
export interface RecordPage {
  items: RecordView[];
  next_cursor: string | null;
}
