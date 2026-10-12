import { visibleAssistantText } from '@fitmind/contracts/assistant-text';
import {
  replyPreview,
  receiptText,
  proposalPreview,
  agentErrorText,
} from '../../../mobile/src/components/chat-presentation';
import {
  planOverview,
  formatPlanPeriod,
  formatPlanDate,
} from '@fitmind/contracts/plan-overview';
export const budgetKeys = [
  'water_ml',
  'calories_kcal',
  'carbs_g',
  'protein_g',
  'fat_g',
];
const names: Record<string, string> = {
  water_ml: '饮水',
  calories_kcal: '热量',
  carbs_g: '碳水',
  protein_g: '蛋白质',
  fat_g: '脂肪',
};
export function number(value: number | null | undefined) {
  return value == null ? '—' : String(Math.round(value * 10) / 10);
}
export function budgetView(key: string, b: any) {
  // An incomplete summary keeps raw remaining/over unknown. The dashboard can
  // still offer a provisional allowance from the recorded subtotal, with its
  // limitation visible; it must never write guessed nutrition back to records.
  const provisional =
    !!b?.incomplete && b?.target != null && Number.isFinite(b?.known_total);
  const remaining = provisional
    ? Math.max(0, b.target - b.known_total)
    : b?.remaining;
  const over = provisional ? Math.max(0, b.known_total - b.target) : b?.over;
  const estimated = !!b?.estimated || provisional;
  const unit =
    key === 'water_ml' ? 'ml' : key === 'calories_kcal' ? 'kcal' : 'g';
  return {
    key,
    name: names[key],
    unit,
    value: b?.target == null ? '—' : number(over > 0 ? over : remaining),
    label: b?.target == null ? '待设目标' : over > 0 ? '已超出' : '还剩',
    total: number(b?.known_total),
    target: number(b?.target),
    over: (over ?? 0) > 0,
    percent:
      b?.target > 0
        ? Math.min(100, Math.max(0, (b.known_total / b.target) * 100))
        : 0,
    note: b?.incomplete ? '待补部分未计入' : b?.estimated ? '含估算记录' : '',
    remaining: remaining == null ? '—' : String(Math.round(remaining)),
    estimated,
    incomplete: !!b?.incomplete,
    status:
      b?.target == null
        ? '未设目标'
        : over > 0
          ? (estimated ? '约超出 ' : '已超出 ') + Math.round(over) + unit
          : provisional
            ? '按已记录估算'
            : '距今日目标',
  };
}
export function positive(value: any, title: string, maximum = 20000) {
  const n = Number(value);
  if (
    String(value).trim() === '' ||
    !Number.isFinite(n) ||
    n <= 0 ||
    n > maximum
  )
    throw new Error(title + '需为大于 0 的有效数值');
  return n;
}
export function optionalNumber(value: any, title: string) {
  if (value == null || String(value).trim() === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0)
    throw new Error(title + '需为非负数，未知请留空');
  return n;
}
export function labelRecord(form: any, date: string) {
  if (!form.name?.trim()) throw new Error('请输入食品名称');
  if (!['g', 'ml', 'serving'].includes(form.unit))
    throw new Error('请选择营养标签的计量单位');
  const basis = positive(form.basis, '标签基准量'),
    consumed = positive(form.consumed, '实际吃了多少');
  const per = {
    calories_kcal: optionalNumber(form.calories, '热量'),
    carbs_g: optionalNumber(form.carbs, '碳水'),
    protein_g: optionalNumber(form.protein, '蛋白质'),
    fat_g: optionalNumber(form.fat, '脂肪'),
  };
  if (Object.values(per).every((x) => x == null))
    throw new Error('至少填写一项营养成分');
  return {
    kind: 'food',
    name: form.name.trim(),
    source: 'label',
    local_date: date,
    nutrition: Object.fromEntries(
      Object.entries(per).map(([k, v]) => [
        k,
        v == null ? null : Math.round(((v * consumed) / basis) * 1000) / 1000,
      ]),
    ),
    label: {
      basis_quantity: basis,
      basis_unit: form.unit,
      consumed_quantity: consumed,
      consumed_unit: form.unit,
      nutrition_per_basis: per,
    },
  };
}
export function exerciseView(e: any) {
  return {
    ...e,
    prescription: `${e.sets} 组 × ${e.reps_min === e.reps_max ? e.reps_min : e.reps_min + '–' + e.reps_max} 次`,
    load:
      e.load_convention === 'bodyweight'
        ? '自重'
        : e.weight_kg == null
          ? '重量待定'
          : `${number(e.weight_kg)} kg${e.load_convention === 'per_hand' ? ' / 每只手' : ''}`,
    rest: `休息 ${e.rest_seconds}s`,
  };
}
export function planView(plan: any) {
  const overview = planOverview(plan);
  return {
    ...plan,
    periodLabel: overview.total
      ? formatPlanPeriod(overview.period.start_date, overview.period.end_date)
      : '尚未安排训练',
    statusLabel: (
      { draft: '待确认', active: '已确认', cancelled: '已取消' } as any
    )[plan.status],
    count: overview.total,
    blocks: [
      ...overview.weekly.map((b) => ({
        id: 'weekly-' + b.days[0].id,
        label: b.label,
        range: b.entire_period
          ? ''
          : formatPlanPeriod(b.start_date, b.end_date),
        name: b.days[0].name,
        exercises: b.days[0].exercises.map(exerciseView),
      })),
      ...overview.single.map((d) => ({
        id: d.id,
        label: formatPlanDate(d.local_date),
        range: '',
        name: d.name,
        exercises: d.exercises.map(exerciseView),
      })),
    ],
    days: plan.days.map((d: any) => ({
      ...d,
      exercises: d.exercises.map(exerciseView),
    })),
  };
}
export function chatView(messages: any[], state?: any) {
  return messages.map((m) => {
    const text = visibleAssistantText(m.result?.assistant_text || '');
    const reply = replyPreview(text);
    return {
      ...m,
      answer: text,
      shortAnswer: reply.preview,
      long: reply.hasDetails,
      createdLabel: m.created_at?.slice(0, 16).replace('T', ' ') + ' UTC',
      proposals: (m.result?.proposals || []).map((p: any) => {
        const current = state
          ? (p.type === 'target' ? state.targets : state.plans)?.find(
              (v: any) => v.id === p.id,
            )
          : p;
        const value = current || p,
          changed =
            current?.status === 'draft' && current.version !== p.version;
        const queued = state?.pending?.some(
          (q: any) =>
            q.path ===
            '/' +
              (p.type === 'target' ? 'targets' : 'plans') +
              '/' +
              p.id +
              '/confirm',
        );
        const canConfirm =
          !!queued || (!!current && current.status === 'draft' && !changed);
        const applied = current?.status === 'active';
        const statusLabel = queued
          ? '确认待重试'
          : applied
            ? '已应用'
            : !current
              ? '已失效'
              : changed
                ? '草案已更新'
                : value.status === 'draft'
                  ? '待确认'
                  : value.status === 'superseded'
                    ? '已替换'
                    : '已取消';
        const overview =
          p.type === 'plan' && value.days ? planOverview(value) : null;
        const macro = (key: string) =>
          value[key] == null ? '未设置' : number(value[key]);
        return {
          ...p,
          category: p.type === 'target' ? '饮食目标' : '运动目标',
          title: p.type === 'target' ? '每日营养与饮水' : value.name,
          preview:
            p.type === 'target'
              ? `热量 ${macro('calories_kcal')} kcal · 饮水 ${macro('water_ml')} ml\n碳水 ${macro('carbs_g')} g · 蛋白质 ${macro('protein_g')} g · 脂肪 ${macro('fat_g')} g`
              : overview?.weekly.length
                ? overview.weekly
                    .map((b) => `${b.label} · ${b.days[0].name}`)
                    .join('\n')
                : proposalPreview(value),
          statusLabel,
          canConfirm,
          confirmLabel: queued ? '重试确认' : '确认并应用',
          timingHint: applied
            ? `已生效 · ${value.effective_from || value.period?.start_date || value.days?.[0]?.local_date || ''} 起`
            : changed
              ? '先查看修订内容，再在详情页确认。'
              : p.type === 'target'
                ? '确认后从今日起使用这些每日额度。'
                : '确认后从今日启用，训练保留原定星期。',
        };
      }),
      errors: [
        ...new Set<string>([
          ...(m.result?.tool_errors || []).map(agentErrorText),
          ...(m.result?.error ? [agentErrorText(m.result.error)] : []),
        ]),
      ],
      receipts: (m.result?.record_receipts || []).map((r: any) => ({
        ...r,
        label: receiptText(r),
      })),
      error: m.result?.error?.message || '',
      pending: ['pending', 'running'].includes(m.status),
      showReply: !!m.result || ['pending', 'running'].includes(m.status),
    };
  });
}
export function recordView(r: any) {
  return {
    ...r,
    title:
      r.kind === 'water'
        ? `${number(r.amount_ml)} ml 水`
        : r.kind === 'food'
          ? r.name
          : `${r.metric} · ${number(r.value)}`,
    subtitle:
      r.kind === 'food'
        ? `${r.source === 'estimate' ? '约 ' : ''}${r.nutrition?.calories_kcal == null ? '未知' : number(r.nutrition.calories_kcal)} kcal · 蛋白质 ${r.nutrition?.protein_g == null ? '未知' : number(r.nutrition.protein_g)} g`
        : r.kind === 'body'
          ? `${number(r.value)} · ${r.metric}`
          : r.note || '已保存',
    time: r.recorded_at?.slice(11, 16) || '',
  };
}
