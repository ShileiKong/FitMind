import type {
  CommandContext,
  RecordInput,
  RecordView,
  RecordPage,
  MutationResult,
} from '@fitmind/contracts';
import type { EntityStore } from '@fitmind/contracts';
import { invariant } from '../../http/errors.js';
import { validateDate } from '../time/service.js';
import { calculateLabel, validateNutrition } from '../nutrition/calculate.js';
export class RecordService {
  constructor(private store: EntityStore) {}
  validate(input: RecordInput) {
    if (input.occurred_at)
      invariant(
        Number.isFinite(Date.parse(input.occurred_at)),
        'INVALID_TIME',
        '事件时间无效',
      );
    if (input.kind === 'water')
      invariant(
        Number.isFinite(input.amount_ml) &&
          input.amount_ml > 0 &&
          input.amount_ml <= 20000,
        'INVALID_AMOUNT',
        '水量必须大于零且不超过 20000ml',
      );
    else if (input.kind === 'food') {
      invariant(
        input.name?.trim() && ['label', 'estimate'].includes(input.source),
        'INVALID_FOOD',
        '请填写食品名称与记录方式',
      );
      validateNutrition(input.nutrition);
      if (input.source === 'label') {
        invariant(
          input.label,
          'LABEL_REQUIRED',
          '准确记录需标签基准与实际食用量',
        );
        input.nutrition = calculateLabel(input.label);
      }
    } else if (input.kind === 'body')
      invariant(
        [
          'weight_kg',
          'body_fat_percent',
          'waist_cm',
          'chest_cm',
          'hip_cm',
          'arm_cm',
        ].includes(input.metric) &&
          Number.isFinite(input.value) &&
          input.value > 0 &&
          input.value <= 1000 &&
          (input.metric !== 'body_fat_percent' || input.value <= 100),
        'INVALID_BODY',
        '身体数据无效',
      );
    else invariant(false, 'INVALID_KIND', '记录类型无效');
  }
  validateAttachments(user: string, input: RecordInput) {
    if (input.kind === 'food')
      for (const id of input.attachment_ids ?? []) {
        const asset = this.store.get<any>(user, 'media', id);
        invariant(asset.kind === 'image', 'NOT_IMAGE', '饮食记录需要图片附件');
      }
  }
  async create(
    ctx: CommandContext,
    input: RecordInput,
  ): Promise<MutationResult<RecordView>> {
    this.validateAttachments(ctx.user_id, input);
    this.validate(input);
    const local_date = validateDate(
      input.local_date ?? ctx.reference_local_date,
    );
    return this.store.mutate(ctx, 'record.create', input, () => {
      const entity = {
        ...input,
        id: this.store.id(),
        local_date,
        occurred_at: input.occurred_at ?? null,
        recorded_at: ctx.now_utc,
        timezone: ctx.timezone,
        source_message_id: ctx.source_message_id ?? null,
        version: 1,
        undone_at: null,
      } as RecordView;
      this.store.put(ctx.user_id, 'record', entity);
      return { entity, version: 1, affected_dates: [local_date] };
    });
  }
  async edit(
    ctx: CommandContext,
    id: string,
    expected_version: number,
    patch: Partial<RecordInput>,
  ): Promise<MutationResult<RecordView>> {
    return this.store.mutate(
      ctx,
      'record.edit:' + id,
      { expected_version, patch },
      () => {
        const old = this.store.get<RecordView>(ctx.user_id, 'record', id);
        invariant(!old.undone_at, 'RECORD_UNDONE', '记录已撤销', 409);
        invariant(
          old.version === expected_version,
          'VERSION_CONFLICT',
          '记录已更新，请刷新后重试',
          409,
        );
        const allowed = [
          'local_date',
          'occurred_at',
          'note',
          ...(old.kind === 'water'
            ? ['amount_ml']
            : old.kind === 'food'
              ? [
                  'name',
                  'source',
                  'nutrition',
                  'label',
                  'assumptions',
                  'attachment_ids',
                ]
              : ['metric', 'value']),
        ];
        invariant(
          Object.keys(patch).every((k) => allowed.includes(k)),
          'INVALID_PATCH',
          '修改含不允许的字段',
        );
        const entity = {
          ...old,
          ...patch,
          id: old.id,
          version: old.version + 1,
        } as RecordView;
        this.validateAttachments(ctx.user_id, entity);
        this.validate(entity);
        validateDate(entity.local_date);
        this.store.put(ctx.user_id, 'record', entity);
        return {
          entity,
          version: entity.version,
          affected_dates: [...new Set([old.local_date, entity.local_date])],
        };
      },
    );
  }
  async undo(ctx: CommandContext, id: string, expected_version: number) {
    return this.store.mutate(
      ctx,
      'record.undo:' + id,
      { expected_version },
      () => {
        const old = this.store.get<RecordView>(ctx.user_id, 'record', id);
        invariant(
          old.version === expected_version,
          'VERSION_CONFLICT',
          '记录已更新',
          409,
        );
        const entity = {
          ...old,
          undone_at: ctx.now_utc,
          version: old.version + 1,
        };
        this.store.put(ctx.user_id, 'record', entity);
        return {
          entity,
          version: entity.version,
          affected_dates: [entity.local_date],
        };
      },
    );
  }
  async list(user_id: string, filter: any = {}): Promise<RecordPage> {
    let items = this.store
      .list<RecordView>(user_id, 'record')
      .filter(
        (r) =>
          !r.undone_at &&
          (!filter.kind || r.kind === filter.kind) &&
          (!filter.local_date || r.local_date === filter.local_date) &&
          (!filter.start_date || r.local_date >= filter.start_date) &&
          (!filter.end_date || r.local_date <= filter.end_date),
      );
    if (filter.cursor) {
      const idx = items.findIndex((r) => r.id === filter.cursor);
      if (idx >= 0) items = items.slice(idx + 1);
    }
    const limit = Math.max(1, Math.min(Number(filter.limit) || 100, 500));
    return {
      items: items.slice(0, limit),
      next_cursor: items.length > limit ? items[limit - 1].id : null,
    };
  }
}
