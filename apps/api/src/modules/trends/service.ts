import type { RecordView } from '@fitmind/contracts';
import type { EntityStore } from '@fitmind/contracts';
import { validateDate } from '../time/service.js';
import { comparable } from '../workouts/recommendation.js';
export class TrendService {
  constructor(private store: EntityStore) {}
  async query(user: string, input: any) {
    if (input.start_date) validateDate(input.start_date);
    if (input.end_date) validateDate(input.end_date);
    const inRange = (x: any) =>
      !x.undone_at &&
      (!input.start_date || x.local_date >= input.start_date) &&
      (!input.end_date || x.local_date <= input.end_date);
    const records = this.store.list<RecordView>(user, 'record').filter(inRange);
    if (input.metric === 'workout') {
      const sessions = this.store.list<any>(user, 'session');
      const movement = input.exercise_id
        ? sessions
            .flatMap((s) => s.snapshot.exercises)
            .find((e) => e.exercise_id === input.exercise_id)
        : null;
      const points = this.store
        .list<any>(user, 'set')
        .filter(inRange)
        .map((set) => ({
          set,
          session: sessions.find((s) => s.id === set.session_id),
        }))
        .map(({ set, session }) => ({
          set,
          prescription: session?.snapshot.exercises.find(
            (p: any) => p.exercise_id === set.exercise_id,
          ),
        }))
        .filter(
          ({ set, prescription }) =>
            prescription &&
            (!input.exercise_id ||
              (movement && comparable(prescription, movement))) &&
            (!input.variant || prescription.variant === input.variant) &&
            (!input.equipment || prescription.equipment === input.equipment) &&
            (!input.load_convention ||
              prescription.load_convention === input.load_convention),
        )
        .map(({ set, prescription }) => ({
          id: set.id,
          local_date: set.local_date,
          weight_kg: set.weight_kg,
          reps: set.reps,
          exercise_id: set.exercise_id,
          name: prescription.name,
          variant: prescription.variant,
          equipment: prescription.equipment,
          load_convention: prescription.load_convention,
        }))
        .sort((a, b) => a.local_date.localeCompare(b.local_date));
      return { metric: 'workout', points };
    }
    if (
      ['water_ml', 'calories_kcal', 'carbs_g', 'protein_g', 'fat_g'].includes(
        input.metric,
      )
    ) {
      const relevant = records.filter(
        (r) => r.kind === (input.metric === 'water_ml' ? 'water' : 'food'),
      );
      const groups = new Map<string, any>();
      for (const r of relevant) {
        const point = groups.get(r.local_date) ?? {
          local_date: r.local_date,
          value: 0,
          incomplete: false,
          estimated: false,
        };
        const value =
          r.kind === 'water' ? r.amount_ml : (r as any).nutrition[input.metric];
        if (value === null) point.incomplete = true;
        else point.value += value;
        if (r.kind === 'food' && r.source === 'estimate')
          point.estimated = true;
        groups.set(r.local_date, point);
      }
      return {
        metric: input.metric,
        points: [...groups.values()].sort((a, b) =>
          a.local_date.localeCompare(b.local_date),
        ),
      };
    }
    return {
      metric: input.metric,
      points: records
        .filter((r) => r.kind === 'body' && r.metric === input.metric)
        .map((r: any) => ({
          id: r.id,
          local_date: r.local_date,
          value: r.value,
        }))
        .sort((a, b) => a.local_date.localeCompare(b.local_date)),
    };
  }
}
