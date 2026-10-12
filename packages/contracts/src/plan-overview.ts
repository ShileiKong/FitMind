import type { PlanView, WorkoutDay } from './plans.js';

const weekMs = 7 * 86400000;
const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export interface PlanBlock {
  weekday: number;
  label: string;
  days: WorkoutDay[];
  start_date: string;
  end_date: string;
  entire_period: boolean;
}
function prescription(day: WorkoutDay) {
  return JSON.stringify([
    day.name,
    day.exercises.map((e) => [
      e.name,
      e.variant,
      e.equipment,
      e.load_convention,
      e.weight_kg,
      e.increment_kg,
      e.sets,
      e.reps_min,
      e.reps_max,
      e.rest_seconds,
    ]),
  ]);
}
export function formatPlanDate(date: string, year = false) {
  const [y, m, d] = date.split('-');
  return `${year ? y + '年' : ''}${Number(m)}月${Number(d)}日`;
}
export function formatPlanPeriod(start: string, end: string) {
  return `${formatPlanDate(start, true)} — ${formatPlanDate(end, start.slice(0, 4) !== end.slice(0, 4))}`;
}
export function planOverview(plan: Pick<PlanView, 'days' | 'period'>) {
  const days = [...plan.days].sort((a, b) =>
    a.local_date.localeCompare(b.local_date),
  );
  const period = plan.period ?? {
    start_date: days[0]?.local_date ?? '',
    end_date: days.at(-1)?.local_date ?? '',
  };
  const weekly: PlanBlock[] = [];
  const single: WorkoutDay[] = [];
  for (const weekday of [1, 2, 3, 4, 5, 6, 0]) {
    const matching = days.filter(
      (d) => new Date(d.local_date + 'T00:00:00Z').getUTCDay() === weekday,
    );
    let run: WorkoutDay[] = [];
    const finish = () => {
      if (!run.length) return;
      if (run.length === 1) single.push(run[0]);
      else {
        let expected = 0;
        for (
          let n = Date.parse(period.start_date);
          n <= Date.parse(period.end_date);
          n += 86400000
        )
          if (new Date(n).getUTCDay() === weekday) expected++;
        weekly.push({
          weekday,
          label: '每' + weekdayNames[weekday],
          days: run,
          start_date: run[0].local_date,
          end_date: run.at(-1)!.local_date,
          entire_period:
            run.length === expected && matching.length === expected,
        });
      }
      run = [];
    };
    for (const day of matching) {
      const previous = run.at(-1);
      if (
        previous &&
        (Date.parse(day.local_date) - Date.parse(previous.local_date) !==
          weekMs ||
          prescription(day) !== prescription(previous))
      )
        finish();
      run.push(day);
    }
    finish();
  }
  single.sort((a, b) => a.local_date.localeCompare(b.local_date));
  return { period, weekly, single, total: days.length };
}
export function planOverviewText(plan: Pick<PlanView, 'days' | 'period'>) {
  const view = planOverview(plan);
  return [
    view.total
      ? formatPlanPeriod(view.period.start_date, view.period.end_date)
      : '尚未安排训练日',
    ...view.weekly.map(
      (b) =>
        `${b.label} · ${b.days[0].name}${b.entire_period ? '' : `（${formatPlanDate(b.start_date)} — ${formatPlanDate(b.end_date, b.start_date.slice(0, 4) !== b.end_date.slice(0, 4))}）`}`,
    ),
    ...(view.single.length ? [`${view.single.length} 个单独安排`] : []),
  ].join('\n');
}
