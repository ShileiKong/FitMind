import type {
  CommandContext,
  TargetDraftInput,
  TargetView,
} from '@fitmind/contracts';
import type { EntityStore } from '@fitmind/contracts';
import { invariant } from '../../http/errors.js';
import { validateDate, resolveDate } from '../time/service.js';
export class TargetService {
  constructor(private store: EntityStore) {}
  async draft(ctx: CommandContext, input: TargetDraftInput) {
    validateDate(input.effective_from);
    if (input.effective_to) {
      validateDate(input.effective_to);
      invariant(
        input.effective_to >= input.effective_from,
        'INVALID_RANGE',
        '结束日期必须晚于生效日期',
      );
    }
    invariant(
      input.effective_from >= ctx.reference_local_date || input.allow_history,
      'HISTORY_CONFIRMATION',
      '修改历史目标需明确确认',
    );
    for (const k of [
      'water_ml',
      'calories_kcal',
      'carbs_g',
      'protein_g',
      'fat_g',
    ] as const)
      invariant(
        input[k] === null ||
          (Number.isFinite(input[k]) && input[k]! >= 0 && input[k]! <= 100000),
        'INVALID_TARGET',
        '目标须为非负数字或未设置',
      );
    return this.store.mutate(ctx, 'target.draft', input, () => {
      const t = {
        ...input,
        id: this.store.id(),
        version: 1,
        status: 'draft',
        effective_to: input.effective_to ?? null,
        created_at: ctx.now_utc,
      } as TargetView;
      this.store.put(ctx.user_id, 'target', t);
      return t;
    });
  }
  async confirm(
    ctx: CommandContext,
    id: string,
    version: number,
    apply_from?: string,
  ) {
    const payload =
      apply_from === undefined ? { version } : { version, apply_from };
    return this.store.mutate(ctx, 'target.confirm:' + id, payload, () => {
      const draft = this.store.get<TargetView>(ctx.user_id, 'target', id);
      invariant(
        draft.version === version,
        'VERSION_CONFLICT',
        '目标已更新',
        409,
      );
      invariant(draft.status === 'draft', 'INVALID_STATE', '只能确认草案');
      const t =
        apply_from === undefined
          ? draft
          : {
              ...draft,
              effective_from: validateDate(apply_from),
              effective_to:
                draft.effective_to === null
                  ? null
                  : validateDate(
                      new Date(
                        Date.parse(apply_from) +
                          Date.parse(draft.effective_to) -
                          Date.parse(draft.effective_from),
                      )
                        .toISOString()
                        .slice(0, 10),
                    ),
            };
      const all = this.store
        .list<TargetView>(ctx.user_id, 'target')
        .filter((x) => x.status === 'active');
      // An open-ended change stops at the next already scheduled target.
      const next = all
        .filter((x) => x.effective_from > t.effective_from)
        .sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0];
      const end =
        t.effective_to ??
        (next ? resolveDate('昨天', next.effective_from) : null);
      for (const old of all) {
        if (
          (old.effective_to && old.effective_to < t.effective_from) ||
          (end && old.effective_from > end)
        )
          continue;
        this.store.put(ctx.user_id, 'target', {
          ...old,
          ...(old.effective_from < t.effective_from
            ? { effective_to: resolveDate('昨天', t.effective_from) }
            : { status: 'superseded' as const }),
          version: old.version + 1,
        });
        if (end && (!old.effective_to || old.effective_to > end)) {
          this.store.put(ctx.user_id, 'target', {
            ...old,
            id: this.store.id(),
            version: 1,
            effective_from: new Date(Date.parse(end) + 86400000)
              .toISOString()
              .slice(0, 10),
          });
        }
      }
      const active = {
        ...t,
        status: 'active' as const,
        version: t.version + 1,
        effective_to: end,
      };
      this.store.put(ctx.user_id, 'target', active);
      return active;
    });
  }
  forDate(user: string, date: string) {
    validateDate(date);
    return (
      this.store
        .list<TargetView>(user, 'target')
        .filter(
          (x) =>
            x.status === 'active' &&
            x.effective_from <= date &&
            (!x.effective_to || x.effective_to >= date),
        )
        .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ??
      null
    );
  }
  list(user: string) {
    return this.store.list<TargetView>(user, 'target');
  }
}
