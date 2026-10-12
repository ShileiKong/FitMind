import { invariant } from '../../http/errors.js';
export const nutrientKeys = [
  'calories_kcal',
  'carbs_g',
  'protein_g',
  'fat_g',
] as const;
export function validateNutrition(n: any) {
  invariant(
    n &&
      nutrientKeys.every(
        (k) =>
          n[k] === null ||
          (Number.isFinite(n[k]) && n[k] >= 0 && n[k] <= 100000),
      ),
    'INVALID_NUTRITION',
    '营养值须为非负数字或未知',
  );
}
export function calculateLabel(input: any): any {
  invariant(
    input &&
      ['g', 'ml', 'serving'].includes(input.basis_unit) &&
      input.basis_unit === input.consumed_unit,
    'UNIT_MISMATCH',
    '标签基准和食用量必须使用相同单位',
  );
  invariant(
    Number.isFinite(input.basis_quantity) &&
      input.basis_quantity > 0 &&
      Number.isFinite(input.consumed_quantity) &&
      input.consumed_quantity > 0,
    'INVALID_QUANTITY',
    '请填写有效的标签基准量和食用量',
  );
  validateNutrition(input.nutrition_per_basis);
  return Object.fromEntries(
    nutrientKeys.map((k) => [
      k,
      input.nutrition_per_basis[k] === null
        ? null
        : Math.round(
            ((input.nutrition_per_basis[k] * input.consumed_quantity) /
              input.basis_quantity) *
              1000,
          ) / 1000,
    ]),
  );
}
