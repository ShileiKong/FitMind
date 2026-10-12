import type { Recommendation, ExercisePrescription } from '@fitmind/contracts';
export function recommendNextSet({
  prescription: p,
  actual: s,
}: any): Recommendation {
  const result: Recommendation = {
    weight_kg: s.weight_kg ?? null,
    reps_min: p.reps_min,
    reps_max: p.reps_max,
    reason_code: 'HOLD',
    basis: [{ id: s.id, version: s.version }],
    rule_version: '1.1',
    status: 'proposed',
  };
  if (s.pain) return { ...result, status: 'paused', reason_code: 'PAIN_PAUSE' };
  if (s.weight_kg == null)
    return { ...result, reason_code: 'UNKNOWN_ACTUAL_LOAD' };
  if (!p.increment_kg) return { ...result, reason_code: 'UNKNOWN_INCREMENT' };
  const hard = s.difficulty === 'hard' || (s.rpe != null && s.rpe >= 8);
  const easy = s.difficulty === 'easy' || (s.rpe != null && s.rpe <= 6);
  if (s.reduce || (hard && s.reps < p.reps_min))
    return {
      ...result,
      weight_kg: Math.max(0, s.weight_kg - p.increment_kg),
      reason_code: 'REDUCE_LOAD',
    };
  if (!hard && easy && s.reps >= p.reps_max)
    return {
      ...result,
      weight_kg: s.weight_kg + p.increment_kg,
      reason_code: 'INCREASE_LOAD',
    };
  return result;
}
export function comparable(a: ExercisePrescription, b: ExercisePrescription) {
  const normalized = (value: string) =>
    value.normalize('NFKC').trim().toLocaleLowerCase();
  return ['name', 'variant', 'equipment', 'load_convention'].every(
    (k) => normalized((a as any)[k]) === normalized((b as any)[k]),
  );
}
export function recommendNextWorkout(
  history: any[],
  p: ExercisePrescription,
): Recommendation {
  const usable = history
    .filter((h) => comparable(h.prescription, p))
    .slice(0, 2);
  const base: Recommendation = {
    weight_kg: p.weight_kg,
    reps_min: p.reps_min,
    reps_max: p.reps_max,
    reason_code: 'NEED_TWO_SUCCESSES',
    basis: usable.flatMap((h) =>
      h.sets.map((s: any) => ({ id: s.id, version: s.version })),
    ),
    rule_version: '1.1',
    status: 'proposed',
  };
  if (p.weight_kg === null || !p.increment_kg)
    return { ...base, reason_code: 'UNKNOWN_LOAD_OR_INCREMENT' };
  if (
    usable.length === 2 &&
    new Set(usable.map((h) => h.session_id)).size === 2 &&
    usable.every(
      (h) =>
        h.sets.length >= p.sets &&
        h.sets.every(
          (s: any) =>
            !s.pain &&
            s.difficulty !== 'hard' &&
            s.weight_kg !== null &&
            s.weight_kg >= p.weight_kg! &&
            s.reps >= p.reps_max &&
            (s.difficulty === 'easy' || (s.rpe != null && s.rpe <= 6)) &&
            !(s.rpe >= 8),
        ),
    )
  )
    return {
      ...base,
      weight_kg: p.weight_kg + p.increment_kg,
      reason_code: 'TWO_SUCCESSES',
    };
  return base;
}
