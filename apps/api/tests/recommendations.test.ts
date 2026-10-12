import { it, expect } from 'vitest';
import {
  recommendNextSet,
  recommendNextWorkout,
} from '../src/modules/workouts/recommendation.js';
const p = {
  exercise_id: 'bench',
  name: '卧推',
  variant: '杠铃平板',
  equipment: 'barbell',
  load_convention: 'total',
  weight_kg: 100,
  increment_kg: 2.5,
  sets: 3,
  reps_min: 10,
  reps_max: 12,
  rest_seconds: 90,
} as any;
const s = {
  id: 's',
  version: 1,
  weight_kg: 100,
  reps: 8,
  difficulty: 'hard',
  rpe: null,
  pain: false,
};
it('hard_missed_target_decreases', () => {
  expect(recommendNextSet({ prescription: p, actual: s }).weight_kg).toBe(97.5);
});
it('easy_upper_target_increases', () => {
  expect(
    recommendNextSet({
      prescription: p,
      actual: { ...s, reps: 12, difficulty: 'easy' },
    }).weight_kg,
  ).toBe(102.5);
});
it('unknown_increment_holds', () => {
  expect(
    recommendNextSet({ prescription: { ...p, increment_kg: null }, actual: s })
      .weight_kg,
  ).toBe(100);
});
it('pain_pauses', () => {
  expect(
    recommendNextSet({ prescription: p, actual: { ...s, pain: true } }).status,
  ).toBe('paused');
});
it('rpe_and_target_hold', () => {
  expect(
    recommendNextSet({
      prescription: p,
      actual: { ...s, reps: 10, difficulty: null, rpe: 8 },
    }).weight_kg,
  ).toBe(100);
});
it('two_comparable_successes_propose_next_load', () => {
  const history = [1, 2].map((x) => ({
    session_id: 'w' + x,
    prescription: p,
    sets: [1, 2, 3].map((y) => ({
      ...s,
      id: 's' + x + y,
      reps: 12,
      difficulty: 'easy',
    })),
  }));
  expect(recommendNextWorkout(history, p).weight_kg).toBe(102.5);
  expect(recommendNextWorkout(history.slice(0, 1), p).weight_kg).toBe(100);
});
