import { commandId } from '../../lib/client';
import { client } from '../../lib/page';
import { optionalNumber } from '../../lib/view';
import {
  formatPlanDate,
  formatPlanPeriod,
  planOverview,
  planOverviewText,
} from '@fitmind/contracts/plan-overview';

export const loadChoices = [
  { key: 'total', label: '总重' },
  { key: 'per_hand', label: '每只手' },
  { key: 'bodyweight', label: '自重' },
  { key: 'machine', label: '器械刻度' },
];
export function shiftDate(date: string, delta: number) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
function newExercise() {
  return {
    exercise_id: commandId(),
    name: '',
    variant: '',
    equipment: '',
    load_convention: 'total',
    weight_kg: '',
    increment_kg: '',
    sets: '3',
    reps_min: '8',
    reps_max: '12',
    rest_seconds: '90',
  };
}
export function planForm(initial: any, date: string) {
  return {
    name: initial?.name || '',
    days: initial
      ? initial.days.map((d: any) => ({
          id: d.id,
          name: d.name,
          local_date: d.local_date,
          exercises: d.exercises.map((e: any) => ({
            ...e,
            ...Object.fromEntries(
              [
                'weight_kg',
                'increment_kg',
                'sets',
                'reps_min',
                'reps_max',
                'rest_seconds',
              ].map((key) => [key, e[key] == null ? '' : String(e[key])]),
            ),
          })),
        }))
      : [
          {
            name: '训练日 A',
            local_date: date ? shiftDate(date, 1) : '',
            exercises: [newExercise()],
          },
        ],
  };
}
export function planInput(form: any) {
  if (!form?.name.trim()) throw new Error('请输入计划名称');
  if (!form.days?.length) throw new Error('至少安排一个训练日');
  const integer = (v: any, title: string, min: number, max: number) => {
    const n = Number(v);
    if (String(v).trim() === '' || !Number.isInteger(n) || n < min || n > max)
      throw new Error(`${title}需为 ${min}–${max} 的整数`);
    return n;
  };
  return {
    name: form.name.trim(),
    days: form.days.map((d: any) => {
      if (!d.name.trim()) throw new Error('请输入训练日名称');
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(d.local_date) ||
        !Number.isFinite(Date.parse(d.local_date + 'T00:00:00Z')) ||
        new Date(d.local_date + 'T00:00:00Z').toISOString().slice(0, 10) !==
          d.local_date
      )
        throw new Error('训练日期需为有效的 YYYY-MM-DD');
      return {
        ...(d.id ? { id: d.id } : {}),
        name: d.name.trim(),
        local_date: d.local_date,
        exercises: d.exercises.map((e: any) => {
          if (!e.name.trim()) throw new Error('请输入动作名称');
          const reps_min = integer(e.reps_min, '目标最少次数', 1, 200),
            reps_max = integer(e.reps_max, '目标最多次数', 1, 200);
          if (reps_max < reps_min)
            throw new Error('目标最多次数不能小于最少次数');
          return {
            exercise_id: e.exercise_id,
            name: e.name.trim(),
            variant: e.variant,
            equipment: e.equipment,
            load_convention: e.load_convention,
            weight_kg: optionalNumber(e.weight_kg, '计划重量'),
            increment_kg: optionalNumber(e.increment_kg, '调整步长'),
            sets: integer(e.sets, '计划组数', 1, 30),
            reps_min,
            reps_max,
            rest_seconds: integer(e.rest_seconds, '组间休息', 0, 3600),
          };
        }),
      };
    }),
  };
}
export function schedulePlan(p: any, today = '') {
  const overview = planOverview(p);
  const exercise = (e: any) => ({
    ...e,
    prescription: `${e.sets} 组 × ${e.reps_min === e.reps_max ? e.reps_min : e.reps_min + '–' + e.reps_max} 次`,
    load: `${e.weight_kg == null ? '重量待定' : e.weight_kg + ' 公斤'} · ${loadChoices.find((choice) => choice.key === e.load_convention)?.label || ''} · 休息 ${e.rest_seconds} 秒`,
  });
  const dates = [...p.days]
    .sort((a: any, b: any) => a.local_date.localeCompare(b.local_date))
    .map((d: any) => ({
      ...d,
      dateLabel: formatPlanDate(d.local_date, true),
      exercises: d.exercises.map(exercise),
    }));
  return {
    ...p,
    statusLabel: (
      { active: '已确认', draft: '待确认', cancelled: '已取消' } as any
    )[p.status],
    overviewText: planOverviewText(p),
    periodLabel: formatPlanPeriod(
      overview.period.start_date,
      overview.period.end_date,
    ),
    count: overview.total,
    weekly: overview.weekly.map((b) => ({
      id: b.days[0].id,
      label: b.label,
      count: b.days.length,
      name: b.days[0].name,
      range: b.entire_period ? '' : formatPlanPeriod(b.start_date, b.end_date),
      exercises: b.days[0].exercises.map(exercise),
    })),
    single: overview.single.map((d) =>
      dates.find((day: any) => day.id === d.id),
    ),
    dates,
    next:
      p.status === 'active' && today
        ? dates.find(
            (d: any) => d.local_date >= today && d.status === 'active',
          ) || null
        : null,
  };
}
export function persistEditor(page: any) {
  client().save(page.editorKey(), {
    editing: page.data.editing,
    form: page.data.editorForm,
    version: page.data.editorVersion ?? null,
  });
}
export function restoreEditor(page: any) {
  const saved = client().saved<any>(page.editorKey(), null);
  if (saved && !page.data.editorForm)
    page.setData({
      editorForm: saved.form,
      editing: saved.editing,
      editorVersion: saved.version ?? null,
    });
}
export function editorMatches(page: any, input: any) {
  try {
    return (
      JSON.stringify(planInput(page.data.editorForm)) === JSON.stringify(input)
    );
  } catch {
    return false;
  }
}
export const editorMethods = {
  planInput(this: any, e: any) {
    const form = JSON.parse(JSON.stringify(this.data.editorForm));
    const { day, exercise, field } = e.currentTarget.dataset;
    if (day == null) form[field] = e.detail.value;
    else if (exercise == null) form.days[Number(day)][field] = e.detail.value;
    else
      form.days[Number(day)].exercises[Number(exercise)][field] =
        e.detail.value;
    this.setData({ editorForm: form });
    persistEditor(this);
  },
  planLoad(this: any, e: any) {
    const form = JSON.parse(JSON.stringify(this.data.editorForm));
    const { day, exercise, key } = e.currentTarget.dataset;
    form.days[Number(day)].exercises[Number(exercise)].load_convention = key;
    this.setData({ editorForm: form });
    persistEditor(this);
  },
  addExercise(this: any, e: any) {
    const form = JSON.parse(JSON.stringify(this.data.editorForm));
    form.days[Number(e.currentTarget.dataset.day)].exercises.push(
      newExercise(),
    );
    this.setData({ editorForm: form });
    persistEditor(this);
  },
  removeExercise(this: any, e: any) {
    const form = JSON.parse(JSON.stringify(this.data.editorForm));
    const d = form.days[Number(e.currentTarget.dataset.day)];
    if (d.exercises.length > 1)
      d.exercises.splice(Number(e.currentTarget.dataset.exercise), 1);
    this.setData({ editorForm: form });
    persistEditor(this);
  },
  addDay(this: any) {
    const form = JSON.parse(JSON.stringify(this.data.editorForm));
    const date = client().data.context?.local_date;
    form.days.push({
      name: '训练日 ' + (form.days.length + 1),
      local_date: date ? shiftDate(date, form.days.length + 1) : '',
      exercises: [newExercise()],
    });
    this.setData({ editorForm: form });
    persistEditor(this);
  },
  removeDay(this: any, e: any) {
    const form = JSON.parse(JSON.stringify(this.data.editorForm));
    if (form.days.length > 1)
      form.days.splice(Number(e.currentTarget.dataset.day), 1);
    this.setData({ editorForm: form });
    persistEditor(this);
  },
};
