import { it, expect, afterEach } from 'vitest';
import { makeHarness } from './helpers.js';
let h: any;
afterEach(async () => {
  if (h) await h.close();
  h = null;
});
const values = {
  calories_kcal: null,
  carbs_g: null,
  protein_g: null,
  fat_g: null,
};
const base = {
  type: 'label_draft',
  name: '食品',
  nutrition: values,
  basis_quantity: null,
  basis_unit: null,
  portion_description: null,
  assumptions: null,
  question: '图片不清楚，请补充标签',
};
const png = Buffer.from('89504e470d0a1a0a', 'hex');
async function setup(output: any) {
  h = await makeHarness({
    providers: {
      vision: {
        analyze: async () => {
          if (output instanceof Error) throw output;
          return output;
        },
      },
    },
  });
  return h.services.media.upload(h.ctx, {
    buffer: png,
    mimetype: 'image/png',
    kind: 'image',
  });
}
it('unreadable_label_keeps_null', async () => {
  const m = await setup(base);
  const a = await h.services.nutrition.analyze(h.ctx, {
    asset_id: m.id,
    mode: 'label',
    description: '',
  });
  expect(a.nutrition.protein_g).toBeNull();
  expect(a.type).toBe('label_draft');
});
it('label_confirm_uses_proportions', async () => {
  const m = await setup({
    ...base,
    nutrition: { ...values, calories_kcal: 200 },
    basis_quantity: 100,
    basis_unit: 'g',
    question: null,
  });
  const a = await h.services.nutrition.analyze(h.ctx, {
    asset_id: m.id,
    mode: 'label',
  });
  const f = await h.services.records.create(
    { ...h.ctx, idempotency_key: 'confirmed' },
    {
      kind: 'food',
      name: a.name,
      source: 'label',
      nutrition: a.nutrition,
      label: {
        basis_quantity: a.basis_quantity,
        basis_unit: a.basis_unit,
        consumed_quantity: 150,
        consumed_unit: 'g',
        nutrition_per_basis: a.nutrition,
      },
      attachment_ids: [m.id],
    },
  );
  expect(f.entity.nutrition.calories_kcal).toBe(300);
});
it('meal_estimate_retains_assumptions', async () => {
  const m = await setup({
    ...base,
    type: 'estimated_food',
    portion_description: '米饭约 150g',
    assumptions: '按熟米饭 150g 估算',
    question: null,
  });
  const a = await h.services.nutrition.analyze(h.ctx, {
    asset_id: m.id,
    mode: 'meal',
    description: '一碗饭',
  });
  expect(a.assumptions).toContain('150g');
  expect((await h.services.records.list('personal')).items).toEqual([]);
});
it('provider_failure_does_not_write_food', async () => {
  const m = await setup(new Error('provider unavailable'));
  await expect(
    h.services.nutrition.analyze(h.ctx, { asset_id: m.id, mode: 'meal' }),
  ).rejects.toThrow();
  expect((await h.services.records.list('personal')).items).toEqual([]);
});
