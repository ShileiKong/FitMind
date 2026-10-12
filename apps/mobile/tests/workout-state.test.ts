import { it, expect } from 'vitest';
import { RestTimer } from '../src/native/rest-timer';
import { WorkoutController } from '../src/state/workout';
it('rest_timer_survives_background', () => {
  const t = new RestTimer(90000);
  expect(t.remaining(30000)).toBe(60);
  expect(t.remaining(100000)).toBe(0);
});
it('session_resume_keeps_progress', async () => {
  const api: any = {
    request: async () => ({
      data: { id: 'w', current_exercise_id: 'row', sets: [{ id: 's' }] },
    }),
  };
  const w = await new WorkoutController(api).resume('w');
  expect(w.current_exercise_id).toBe('row');
  expect(w.sets).toHaveLength(1);
});
