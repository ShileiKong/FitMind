import { budgetView, number } from './view';

export const nutrientDetailKeys = [
  'water_ml',
  'calories_kcal',
  'carbs_g',
  'protein_g',
  'fat_g',
] as const;
export type NutrientDetailKey = (typeof nutrientDetailKeys)[number];

export function nutrientSelection(options: any, currentDate: string) {
  if (!nutrientDetailKeys.includes(options?.key))
    throw new Error('请选择有效的营养或饮水项目');
  const date = options.date === undefined ? currentDate : options.date;
  if (
    typeof date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date + 'T00:00:00Z')) ||
    new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date
  )
    throw new Error('请选择有效日期 YYYY-MM-DD');
  return { key: options.key as NutrientDetailKey, date };
}

const knownAmount = (value: any): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** A display projection only: unknown nutrition stays unknown in the record. */
export function nutrientBreakdown(
  records: any[],
  date: string,
  key: NutrientDetailKey,
  summary: any,
) {
  nutrientSelection({ date, key }, '');
  const kind = key === 'water_ml' ? 'water' : 'food';
  const selected = records.filter(
    (record) =>
      record.kind === kind && record.local_date === date && !record.undone_at,
  );
  const amountFor = (record: any) =>
    kind === 'water' ? record.amount_ml : record.nutrition?.[key];
  const knownTotal =
    Math.round(
      selected.reduce(
        (total, record) =>
          total + (knownAmount(amountFor(record)) ? amountFor(record) : 0),
        0,
      ) * 1000,
    ) / 1000;
  const unknownCount = selected.filter(
    (record) => !knownAmount(amountFor(record)),
  ).length;
  const estimated = selected.some(
    (record) => knownAmount(amountFor(record)) && record.source === 'estimate',
  );
  const target = knownAmount(summary?.[key]?.target)
    ? summary[key].target
    : null;
  const budget = budgetView(key, {
    target,
    known_total: knownTotal,
    incomplete: unknownCount > 0,
    estimated,
    remaining:
      target == null || unknownCount ? null : Math.max(0, target - knownTotal),
    over:
      target == null || unknownCount ? null : Math.max(0, knownTotal - target),
  });
  const rows = selected.map((record) => {
    const amount = amountFor(record),
      known = knownAmount(amount);
    const estimate = record.source === 'estimate';
    const sharePercent = known
      ? knownTotal > 0
        ? Math.round((amount / knownTotal) * 1000) / 10
        : 0
      : null;
    const label = record.label;
    const quantityText =
      kind === 'food' && label && knownAmount(label.consumed_quantity)
        ? '实际食用 ' +
          number(label.consumed_quantity) +
          ' ' +
          (label.consumed_unit === 'serving' ? '份' : label.consumed_unit || '')
        : '';
    return {
      id: record.id,
      kind,
      name: kind === 'water' ? '饮水记录' : record.name,
      known,
      amount: known ? amount : null,
      amountText: known ? (estimate ? '约 ' : '') + number(amount) : '待补',
      sharePercent,
      shareText: sharePercent == null ? '待补' : number(sharePercent) + '%',
      sourceLabel: kind === 'water' ? '已记录' : estimate ? '估算' : '营养标签',
      estimated: estimate,
      quantityText,
      assumptionsText:
        kind === 'food' ? String(record.assumptions || '').trim() : '',
      note: String(record.note || '').trim(),
      editUrl:
        '/pages/editor/index?mode=' +
        kind +
        '&id=' +
        encodeURIComponent(record.id),
    };
  });
  return {
    date,
    key,
    kind,
    name: budget.name,
    unit: budget.unit,
    knownTotal,
    unknownCount,
    budget,
    rows,
  };
}

export async function fetchNutrientBreakdown(
  c: { request(method: string, path: string): Promise<any> },
  date: string,
  key: NutrientDetailKey,
  current: () => boolean = () => true,
) {
  nutrientSelection({ date, key }, '');
  if (!current()) return null;
  const kind = key === 'water_ml' ? 'water' : 'food';
  const path =
    '/records?local_date=' +
    encodeURIComponent(date) +
    '&kind=' +
    kind +
    '&limit=100';
  const [summary, first] = await Promise.all([
    c.request('GET', '/days/' + date + '/summary'),
    c.request('GET', path),
  ]);
  if (!current()) return null;
  if (summary?.local_date && summary.local_date !== date)
    throw new Error('日期摘要不一致，请重新加载');
  const records = new Map<string, any>(),
    cursors = new Set<string>();
  let page = first;
  while (true) {
    if (!Array.isArray(page?.items))
      throw new Error('来源记录未能加载，请重试');
    for (const record of page.items) records.set(record.id, record);
    const cursor = page.next_cursor;
    if (cursor == null) break;
    if (typeof cursor !== 'string' || !cursor || cursors.has(cursor))
      throw new Error('来源记录分页异常，请重试');
    cursors.add(cursor);
    page = await c.request(
      'GET',
      path + '&cursor=' + encodeURIComponent(cursor),
    );
    if (!current()) return null;
  }
  return nutrientBreakdown([...records.values()], date, key, summary);
}
