import type { DailySummary, RecordView } from '@fitmind/contracts';
import type { EntityStore } from '@fitmind/contracts';
import { TargetService } from '../targets/service.js';
import { nutrientKeys } from '../nutrition/calculate.js';
import { validateDate } from '../time/service.js';
export class SummaryService {
  constructor(
    private store: EntityStore,
    private targets: TargetService,
  ) {}
  async forDate(user: string, date: string): Promise<DailySummary> {
    validateDate(date);
    const target = this.targets.forDate(user, date);
    const records = this.store
      .list<RecordView>(user, 'record')
      .filter((x) => !x.undone_at && x.local_date === date);
    const result: any = {
      local_date: date,
      target_id: target?.id ?? null,
      record_count: records.length,
    };
    for (const key of ['water_ml', ...nutrientKeys] as const) {
      let known_total = 0,
        incomplete = false,
        estimated = false;
      for (const rec of records) {
        if (key === 'water_ml' && rec.kind === 'water')
          known_total += rec.amount_ml;
        else if (key !== 'water_ml' && rec.kind === 'food') {
          if (rec.nutrition[key] === null) incomplete = true;
          else {
            known_total += rec.nutrition[key];
            if (rec.source === 'estimate') estimated = true;
          }
        }
      }
      known_total = Math.round(known_total * 1000) / 1000;
      const goal = target?.[key] ?? null;
      result[key] = {
        target: goal,
        known_total,
        remaining:
          goal === null || incomplete ? null : Math.max(0, goal - known_total),
        over:
          goal === null || incomplete ? null : Math.max(0, known_total - goal),
        incomplete,
        estimated,
      };
    }
    return result;
  }
}
