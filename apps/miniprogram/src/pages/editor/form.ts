import { optionalNumber, positive } from '../../lib/view';

export const nutritionFields = [
  { key: 'calories_kcal', label: '热量 kcal' },
  { key: 'carbs_g', label: '碳水 g' },
  { key: 'protein_g', label: '蛋白质 g' },
  { key: 'fat_g', label: '脂肪 g' },
];
export const bodyFields = [
  { key: 'weight_kg', label: '体重 kg' },
  { key: 'body_fat_percent', label: '体脂率 %' },
  { key: 'waist_cm', label: '腰围 cm' },
  { key: 'chest_cm', label: '胸围 cm' },
  { key: 'hip_cm', label: '臀围 cm' },
  { key: 'arm_cm', label: '臂围 cm' },
];
export const editorTitles: Record<string, string> = {
  water: '饮水记录',
  food: '饮食记录',
  body: '身体数据',
  target: '每日目标',
  memory: '更正长期记忆',
};
export function formFor(entity: any, date: string) {
  const form: any = {
    local_date: date,
    effective_from: date,
    amount_ml: '250',
    name: '',
    source: 'estimate',
    calories_kcal: '',
    carbs_g: '',
    protein_g: '',
    fat_g: '',
    water_ml: '',
    metric: 'weight_kg',
    value: '',
    assumptions: '',
    basis_quantity: '100',
    consumed_quantity: '',
    basis_unit: 'g',
    note: '',
  };
  if (!entity) return form;
  for (const [key, value] of Object.entries(entity))
    form[key] = typeof value === 'number' ? String(value) : value;
  if (entity.label) {
    form.basis_quantity = String(entity.label.basis_quantity);
    form.consumed_quantity = String(entity.label.consumed_quantity);
    form.basis_unit = entity.label.basis_unit;
  }
  const nutrition =
    entity.kind === 'food'
      ? entity.source === 'label'
        ? entity.label?.nutrition_per_basis
        : entity.nutrition
      : entity;
  for (const { key } of nutritionFields)
    form[key] = nutrition?.[key] == null ? '' : String(nutrition[key]);
  if (entity.water_ml == null) form.water_ml = '';
  return form;
}
function date(value: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value || '') ||
    !Number.isFinite(Date.parse(value + 'T00:00:00Z')) ||
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value
  )
    throw new Error('请填写有效日期 YYYY-MM-DD');
  return value;
}
export function saveCommand(
  mode: string,
  id: string,
  entity: any,
  form: any,
  history: boolean,
) {
  if (id && !entity)
    throw new Error('原记录尚未加载，不能提交更正；联网后重新加载');
  if (mode === 'memory') {
    if (!entity || !String(form.value || '').trim())
      throw new Error('记忆内容不能为空');
    return {
      path: '/memories/' + entity.id,
      method: 'PATCH',
      body: { expected_version: entity.version, value: form.value },
    };
  }
  const nutrition = Object.fromEntries(
    nutritionFields.map(({ key, label }) => [
      key,
      optionalNumber(form[key], label),
    ]),
  );
  if (mode === 'target')
    return {
      path: '/targets/drafts',
      method: 'POST',
      body: {
        effective_from: date(form.effective_from),
        allow_history: history,
        water_ml: optionalNumber(form.water_ml, '饮水目标'),
        ...nutrition,
      },
    };
  const body: any = {
    kind: mode,
    local_date: date(form.local_date),
    ...(form.note ? { note: form.note } : {}),
  };
  if (mode === 'water') body.amount_ml = positive(form.amount_ml, '饮水量');
  if (mode === 'body') {
    const metric = bodyFields.find((field) => field.key === form.metric);
    if (!metric) throw new Error('请选择身体数据类型');
    body.metric = form.metric;
    body.value = positive(
      form.value,
      metric.label,
      form.metric === 'body_fat_percent' ? 100 : 1000,
    );
  }
  if (mode === 'food') {
    if (!form.name?.trim()) throw new Error('请输入食品名称');
    if (!['label', 'estimate'].includes(form.source))
      throw new Error('请选择饮食记录方式');
    body.name = form.name;
    body.source = form.source;
    body.nutrition = nutrition;
    if (form.source === 'label') {
      if (!['g', 'ml', 'serving'].includes(form.basis_unit))
        throw new Error('请选择营养标签的计量单位');
      body.label = {
        basis_quantity: positive(form.basis_quantity, '标签对应量'),
        basis_unit: form.basis_unit,
        consumed_quantity: positive(form.consumed_quantity, '实际食用量'),
        consumed_unit: form.basis_unit,
        nutrition_per_basis: nutrition,
      };
    } else {
      if (!form.assumptions?.trim()) throw new Error('请说明估算份量和依据');
      body.assumptions = form.assumptions;
      if (entity?.label) body.label = null;
    }
    if (entity?.attachment_ids) body.attachment_ids = entity.attachment_ids;
  }
  if (entity) {
    const { kind, ...patch } = body;
    return {
      path: '/records/' + entity.id,
      method: 'PATCH',
      body: { expected_version: entity.version, patch },
    };
  }
  return { path: '/records', method: 'POST', body };
}
