import { NutritionAnalysisSchema } from '@fitmind/contracts';
import { Value } from 'typebox/value';
import { client, definePage } from '../../lib/page';
import { syncAppearance } from '../../lib/appearance';
import { commandId } from '../../lib/client';
import { optionalNumber, positive } from '../../lib/view';
import {
  calculateLabel,
  validateNutrition,
} from '../../../../api/src/modules/nutrition/calculate';

const units = ['', 'g', 'ml', 'serving'];
const nutrientFields = ['calories', 'carbs', 'protein', 'fat'];
const copy = (value: any) => JSON.parse(JSON.stringify(value));
const initial = {
  assetId: '',
  mode: 'meal',
  previewPath: '',
  date: '',
  form: {
    name: '',
    calories: '',
    carbs: '',
    protein: '',
    fat: '',
    portion: '',
    assumptions: '',
    basis: '',
    basis_unit: '',
    consumed: '',
    consumed_unit: '',
  },
  units: ['请选择单位', '克 g', '毫升 ml', '份'],
  basisUnitIndex: 0,
  consumedUnitIndex: 0,
  descriptionText: '',
  question: '',
  ready: false,
  loaded: false,
  portionChanged: false,
  nutritionEdited: false,
  manualTotalsChecked: false,
  busy: false,
  error: '',
  recordId: '',
  receipt: '',
  retryPending: false,
  originalConfirmation: null,
};
function validDate(value: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value
  )
    throw new Error('请选择有效记录日期。');
  return value;
}
function active(page: any, life?: number) {
  return (
    page._visible !== false &&
    client() === page._reviewClient &&
    client().storageKey === page._reviewScope &&
    (life == null || page._reviewLife === life)
  );
}
function bodyFor(page: any) {
  if (!page.data.ready) throw new Error('请先完成识别并核对结果。');
  const f = page.data.form;
  if (!f.name.trim() || f.name.trim().length > 200)
    throw new Error('请输入不超过200字的食品名称。');
  const values = nutrientFields.map((field) =>
    optionalNumber(f[field], '营养数值'),
  );
  if (values.every((value) => value == null))
    throw new Error('请至少填写一项营养成分。');
  const nutrition = Object.fromEntries(
    ['calories_kcal', 'carbs_g', 'protein_g', 'fat_g'].map((key, i) => [
      key,
      values[i],
    ]),
  );
  validateNutrition(nutrition);
  const body: any = {
    kind: 'food',
    name: f.name.trim(),
    source: page.data.mode === 'label' ? 'label' : 'estimate',
    nutrition,
    attachment_ids: [page.data.assetId],
    local_date: validDate(page.data.date),
    occurred_at: null,
  };
  if (page.data.mode === 'label') {
    const basis = positive(f.basis, '标签基准量'),
      consumed = positive(f.consumed, '实际食用量');
    if (
      !units.slice(1).includes(f.basis_unit) ||
      !units.slice(1).includes(f.consumed_unit)
    )
      throw new Error('请选择标签与食用量的单位。');
    if (f.basis_unit !== f.consumed_unit)
      throw new Error(
        '请把实际食用量换算为与标签相同的单位，不能直接按克与毫升换算。',
      );
    body.label = {
      basis_quantity: basis,
      basis_unit: f.basis_unit,
      consumed_quantity: consumed,
      consumed_unit: f.consumed_unit,
      nutrition_per_basis: nutrition,
    };
    body.nutrition = calculateLabel(body.label);
    validateNutrition(body.nutrition);
  } else {
    if (!f.portion.trim() || !f.assumptions.trim())
      throw new Error('请补充整份食用量和估算依据。');
    if (
      page.data.portionChanged &&
      !(page.data.nutritionEdited && page.data.manualTotalsChecked)
    )
      throw new Error(
        '份量已改变，请重新识别，或修改整份营养合计并勾选已核对。',
      );
    body.assumptions =
      f.portion.trim() +
      '；' +
      f.assumptions.trim() +
      (page.data.portionChanged ? '；份量与营养合计由用户手动核对' : '');
    if (body.assumptions.length > 2000)
      throw new Error('份量与估算依据合计请保持在2000字以内。');
  }
  return body;
}
function savedResult(page: any) {
  if (!active(page)) return;
  if (!page._savedRecord) {
    const queued = page._reviewClient
      .pending()
      .find((p: any) => p.id === page._recordPendingId);
    if (queued?.error)
      page.setData({ busy: false, retryPending: true, error: queued.error });
    return;
  }
  page.setData({
    recordId: page._savedRecord.id,
    receipt: '已保存 · ' + page._savedRecord.name,
    busy: false,
    retryPending: false,
    error: '',
  });
}
function originalConfirmation(body: any) {
  const value = (key: string, unit: string) =>
    body.nutrition[key] == null ? '未知' : body.nutrition[key] + ' ' + unit;
  return {
    name: body.name,
    date: body.local_date,
    nutrition:
      '整份合计 · 热量 ' +
      value('calories_kcal', 'kcal') +
      ' · 碳水 ' +
      value('carbs_g', 'g') +
      ' · 蛋白质 ' +
      value('protein_g', 'g') +
      ' · 脂肪 ' +
      value('fat_g', 'g'),
  };
}
function leave(page: any) {
  page._visible = false;
  page._reviewLife = (page._reviewLife || 0) + 1;
  clearInterval(page._timer);
}

Page(
  definePage({
    data: initial,
    onLoad(options: any) {
      this._reviewClient = client();
      this._reviewScope = client().storageKey;
      this._reviewLife = 0;
      this.setData({
        assetId: options.asset || '',
        mode: options.mode === 'label' ? 'label' : 'meal',
      });
    },
    async onShow() {
      this._visible = true;
      this._reviewLife = (this._reviewLife || 0) + 1;
      syncAppearance(this, true);
      if (!active(this)) {
        this.setData({
          ...copy(initial),
          error: '资料已更换，请重新选择照片。',
        });
        return;
      }
      this.setData({ busy: !!this._saveWork });
      if (this._saveWork) {
        const life = this._reviewLife;
        void this._saveWork
          .finally(() => {
            if (active(this, life)) {
              savedResult(this);
              this.setData({ busy: false });
            }
          })
          .catch(() => {});
      }
      savedResult(this);
      await this.load();
    },
    onHide() {
      leave(this);
    },
    onUnload() {
      leave(this);
    },
    async load() {
      if (
        !active(this) ||
        this.data.loaded ||
        (this._assetLoading && this._assetLoadLife === this._reviewLife)
      )
        return;
      const life = this._reviewLife,
        c = this._reviewClient;
      this._assetLoading = true;
      this._assetLoadLife = life;
      this.setData({ busy: true, error: '' });
      try {
        const asset = await c.request(
          'GET',
          '/media/' + encodeURIComponent(this.data.assetId),
        );
        if (!active(this, life)) return;
        if (asset.kind !== 'image' || !asset.preview_path)
          throw new Error('照片已失效，请重新选择。');
        this.setData({
          previewPath: asset.preview_path,
          date: validDate(asset.local_date),
          loaded: true,
          busy: false,
        });
        const queued = c
          .pending()
          .find(
            (p: any) =>
              p.path === '/records' &&
              p.body.attachment_ids?.includes(this.data.assetId),
          );
        if (queued) {
          this._fixedBody = copy(queued.body);
          this._recordPendingId = queued.id;
          this.setData({
            retryPending: true,
            error: queued.error || '',
            originalConfirmation: originalConfirmation(queued.body),
          });
          return;
        }
        await this.analyze();
      } catch (error: any) {
        if (active(this, life))
          this.setData({
            error: error.message || '照片读取失败。',
            busy: false,
          });
      } finally {
        if (this._assetLoadLife === life) this._assetLoading = false;
      }
    },
    input(e: any) {
      if (!active(this) || this.data.busy || this.data.recordId) return;
      const field = e.currentTarget.dataset.field;
      if (!(field in this.data.form)) return;
      this.setData({ ['form.' + field]: e.detail.value });
      if (field === 'portion')
        this.setData({
          portionChanged: e.detail.value !== this._analysisPortion,
          manualTotalsChecked: false,
        });
      if (nutrientFields.includes(field))
        this.setData({
          nutritionEdited: nutrientFields.some(
            (key) => this.data.form[key] !== this._analysisNutrition?.[key],
          ),
        });
    },
    unit(e: any) {
      if (!active(this) || this.data.busy || this.data.recordId) return;
      const index = Number(e.detail.value),
        field = e.currentTarget.dataset.field;
      if (!units[index] || !['basis_unit', 'consumed_unit'].includes(field))
        return;
      this.setData({
        ['form.' + field]: units[index],
        [field === 'basis_unit' ? 'basisUnitIndex' : 'consumedUnitIndex']:
          index,
      });
    },
    date(e: any) {
      if (active(this) && !this.data.busy && !this.data.recordId)
        this.setData({ date: e.detail.value });
    },
    description(e: any) {
      if (active(this) && !this.data.busy && !this.data.recordId)
        this.setData({ descriptionText: e.detail.value });
    },
    manualTotals(e: any) {
      if (active(this) && !this.data.busy && !this.data.recordId)
        this.setData({
          manualTotalsChecked: e.detail.value.includes('checked'),
        });
    },
    async analyze() {
      if (
        !active(this) ||
        this.data.busy ||
        this.data.recordId ||
        this._fixedBody
      )
        return;
      const life = this._reviewLife,
        c = this._reviewClient;
      const description = [
        this.data.descriptionText.trim(),
        this.data.portionChanged ? '食用份量：' + this.data.form.portion : '',
      ]
        .filter(Boolean)
        .join('\n');
      this.setData({ busy: true, ready: false, question: '', error: '' });
      try {
        const result = await c.request(
          'POST',
          '/nutrition/analyze',
          {
            asset_id: this.data.assetId,
            mode: this.data.mode,
            ...(description ? { description } : {}),
          },
          commandId(),
        );
        if (!active(this, life)) return;
        if (!Value.Check(NutritionAnalysisSchema, result))
          throw new Error('照片识别结果格式无效，请重新识别。');
        if (result.type === 'needs_input') {
          this.setData({
            question: result.question || '请补充食物和食用份量，再识别。',
          });
          return;
        }
        if (
          (this.data.mode === 'meal' && result.type !== 'estimated_food') ||
          (this.data.mode === 'label' && result.type !== 'label_draft')
        )
          throw new Error('识别结果与照片模式不一致，请重新识别。');
        if (
          this.data.mode === 'meal' &&
          (!result.portion_description?.trim() || !result.assumptions?.trim())
        )
          throw new Error('请补充整份食用量，再重新识别。');
        const value = (v: any) => (v == null ? '' : String(v));
        const form = {
          name: result.name,
          calories: value(result.nutrition.calories_kcal),
          carbs: value(result.nutrition.carbs_g),
          protein: value(result.nutrition.protein_g),
          fat: value(result.nutrition.fat_g),
          portion: result.portion_description || '',
          assumptions: result.assumptions || '',
          basis: value(result.basis_quantity),
          basis_unit: result.basis_unit || '',
          consumed: '',
          consumed_unit: result.basis_unit || '',
        };
        this._analysisPortion = form.portion;
        this._analysisNutrition = { ...form };
        this.setData({
          form,
          ready: true,
          portionChanged: false,
          nutritionEdited: false,
          manualTotalsChecked: false,
          basisUnitIndex: units.indexOf(form.basis_unit),
          consumedUnitIndex: units.indexOf(form.consumed_unit),
        });
      } catch (error: any) {
        if (active(this, life))
          this.setData({ error: error.message || '照片识别失败，请重试。' });
      } finally {
        if (active(this, life)) this.setData({ busy: false });
      }
    },
    async confirm() {
      if (
        !active(this) ||
        this.data.busy ||
        this.data.recordId ||
        this._saveWork
      )
        return;
      const c = this._reviewClient,
        scope = this._reviewScope,
        life = this._reviewLife;
      const same = () => client() === c && c.storageKey === scope;
      try {
        if (!this._fixedBody) this._fixedBody = copy(bodyFor(this));
        this.setData({
          busy: true,
          error: '',
          originalConfirmation: originalConfirmation(this._fixedBody),
        });
        const existing =
          this._recordPendingId &&
          c.pending().find((p: any) => p.id === this._recordPendingId);
        if (this._recordPendingId && !existing)
          throw new Error(
            '原确认输入已处理或移除，请先查看记录，避免重复保存。',
          );
        const work = existing
          ? c.retry(existing.id)
          : c.mutate('/records', this._fixedBody);
        this._saveWork = work;
        this._recordPendingId =
          existing?.id ||
          c
            .pending()
            .find(
              (p: any) =>
                p.path === '/records' &&
                JSON.stringify(p.body) === JSON.stringify(this._fixedBody),
            )?.id;
        const result = await work;
        if (same() && result?.entity?.id) this._savedRecord = result.entity;
        if (active(this, life)) {
          if (!this._savedRecord)
            throw new Error('没有收到有效保存回执，请先检查记录。');
          savedResult(this);
        }
      } catch (error: any) {
        if (active(this, life))
          this.setData({
            error: error.message || '保存失败，请重试原确认输入。',
            retryPending: !!this._fixedBody,
          });
      } finally {
        this._saveWork = null;
        if (active(this, life)) this.setData({ busy: false });
      }
    },
    cancel() {
      if (active(this) && !this.data.busy) wx.navigateBack({});
    },
  }),
);
