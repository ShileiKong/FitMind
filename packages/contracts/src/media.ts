import { Type, NullableNumber, type Static } from './common.js';
import { NutritionSchema } from './records.js';
export const AnalysisRequestSchema = Type.Object(
  {
    asset_id: Type.String(),
    mode: Type.Union([Type.Literal('label'), Type.Literal('meal')]),
    description: Type.Optional(Type.String({ maxLength: 2000 })),
  },
  { additionalProperties: false },
);
export const NutritionAnalysisSchema = Type.Object(
  {
    type: Type.Union([
      Type.Literal('label_draft'),
      Type.Literal('estimated_food'),
      Type.Literal('needs_input'),
    ]),
    name: Type.String(),
    nutrition: NutritionSchema,
    basis_quantity: NullableNumber,
    basis_unit: Type.Union([
      Type.Literal('g'),
      Type.Literal('ml'),
      Type.Literal('serving'),
      Type.Null(),
    ]),
    portion_description: Type.Union([Type.String(), Type.Null()]),
    assumptions: Type.Union([Type.String(), Type.Null()]),
    question: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);
export type NutritionAnalysis = Static<typeof NutritionAnalysisSchema>;
export interface MediaAsset {
  id: string;
  kind: 'image' | 'audio';
  mime_type: string;
  size_bytes: number;
  created_at: string;
  version: number;
}
