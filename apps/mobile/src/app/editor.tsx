import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useApp } from '../state/app';
import { useSubmission } from '../state/use-submission';
import { Screen, Card, Field, Button } from '../components/ui';
import { ui, colors } from '../theme';
const keys = ['calories_kcal', 'carbs_g', 'protein_g', 'fat_g'];
const labels = ['热量 kcal', '碳水 g', '蛋白质 g', '脂肪 g'];
const bodyLabels: any = {
  weight_kg: '体重 kg',
  body_fat_percent: '体脂率 %',
  waist_cm: '腰围 cm',
  chest_cm: '胸围 cm',
  hip_cm: '臀围 cm',
  arm_cm: '臂围 cm',
};
const num = (v: string) => (v.trim() === '' ? null : Number(v));
const defaults: any = {
  local_date: '',
  amount_ml: '250',
  name: '',
  source: 'estimate',
  calories_kcal: '',
  carbs_g: '',
  protein_g: '',
  fat_g: '',
  water_ml: '',
  metric: 'weight_kg',
  value: '',
  assumptions: '',
  basis_quantity: '100',
  consumed_quantity: '',
  basis_unit: 'g',
  note: '',
};
function formFor(old: any, date: string) {
  if (!old) return { ...defaults, local_date: date, effective_from: date };
  const n =
    old.kind === 'food'
      ? old.source === 'label'
        ? old.label?.nutrition_per_basis
        : old.nutrition
      : old;
  const f: any = {
    ...defaults,
    ...Object.fromEntries(
      Object.entries(old).map(([k, v]) => [
        k,
        typeof v === 'number' ? String(v) : v,
      ]),
    ),
    ...(old.label
      ? {
          basis_quantity: String(old.label.basis_quantity),
          consumed_quantity: String(old.label.consumed_quantity),
          basis_unit: old.label.basis_unit,
        }
      : {}),
  };
  for (const k of keys) f[k] = n?.[k] == null ? '' : String(n[k]);
  return f;
}
export default function Editor() {
  const { mode = 'water', id } = useLocalSearchParams<{
    mode: string;
    id?: string;
  }>();
  const a = useApp();
  const submission = useSubmission();
  const cached = id
    ? (mode === 'target'
        ? a.targets
        : mode === 'memory'
          ? a.memories
          : a.records
      ).find((x: any) => x.id === id)
    : null;
  const [dirty, setDirty] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [form, setForm] = useState<any>(() =>
      formFor(cached, a.context?.local_date ?? ''),
    ),
    [entity, setEntity] = useState<any>(cached ?? null),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false),
    [draft, setDraft] = useState<any>(
      mode === 'target' && cached?.status === 'draft' ? cached : null,
    ),
    [history, setHistory] = useState(false);
  const set = (k: string, v: any) => {
    setDirty(true);
    setForm((f: any) => ({ ...f, [k]: v }));
  };
  useEffect(() => {
    if (!id || dirty) return;
    let alive = true;
    const load = async () => {
      const old =
        mode === 'target'
          ? (await a.api.request('GET', '/targets')).data.find(
              (t: any) => t.id === id,
            )
          : mode === 'memory'
            ? (await a.api.request('GET', '/memories')).data.find(
                (m: any) => m.id === id,
              )
            : (await a.api.request('GET', '/records/' + id)).data;
      if (!old) throw new Error('未找到原记录，请刷新后重试');
      if (!alive) return;
      setEntity(old);
      if (mode === 'target' && old.status === 'draft') setDraft(old);
      const n =
        old.kind === 'food'
          ? old.source === 'label'
            ? old.label?.nutrition_per_basis
            : old.nutrition
          : old;
      const f = {
        ...defaults,
        ...Object.fromEntries(
          Object.entries(old).map(([k, v]) => [
            k,
            typeof v === 'number' ? String(v) : v,
          ]),
        ),
        ...(old.label
          ? {
              basis_quantity: String(old.label.basis_quantity),
              consumed_quantity: String(old.label.consumed_quantity),
              basis_unit: old.label.basis_unit,
            }
          : {}),
      };
      for (const k of keys) f[k] = n?.[k] == null ? '' : String(n[k]);
      setForm(f);
    };
    void load().catch((e) => {
      if (alive) setError(e.message);
    });
    return () => {
      alive = false;
    };
  }, [id, mode, a.api, attempt, dirty]);
  async function save() {
    setSaving(true);
    setError('');
    try {
      if (id && !entity)
        throw new Error('原记录尚未加载，不能提交更正；联网后重新加载');
      if (mode === 'memory') {
        await submission.mutate(
          '/memories/' + id,
          { expected_version: entity.version, value: form.value },
          'PATCH',
        );
        submission.complete();
        router.back();
        return;
      }
      if (mode === 'target') {
        const d = await submission.mutate('/targets/drafts', {
          effective_from: form.effective_from,
          allow_history: history,
          water_ml: num(form.water_ml),
          ...Object.fromEntries(keys.map((k) => [k, num(form[k])])),
        });
        setDraft(d);
        submission.complete();
        return;
      }
      const payload: any = {
        kind: mode,
        local_date: form.local_date,
        ...(form.note ? { note: form.note } : {}),
      };
      if (mode === 'water') payload.amount_ml = num(form.amount_ml);
      if (mode === 'body') {
        payload.metric = form.metric;
        payload.value = num(form.value);
      }
      if (mode === 'food') {
        payload.name = form.name;
        payload.source = form.source;
        payload.nutrition = Object.fromEntries(
          keys.map((k) => [k, num(form[k])]),
        );
        if (form.source === 'label')
          payload.label = {
            basis_quantity: num(form.basis_quantity),
            basis_unit: form.basis_unit,
            consumed_quantity: num(form.consumed_quantity),
            consumed_unit: form.basis_unit,
            nutrition_per_basis: payload.nutrition,
          };
        else {
          if (!form.assumptions.trim()) throw new Error('请说明估算份量和依据');
          payload.assumptions = form.assumptions;
        }
        if (entity?.attachment_ids)
          payload.attachment_ids = entity.attachment_ids;
      }
      if (entity) {
        const { kind, ...patch } = payload;
        await submission.mutate(
          '/records/' + entity.id,
          { expected_version: entity.version, patch },
          'PATCH',
        );
      } else await submission.mutate('/records', payload);
      submission.complete();
      router.back();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  const title =
    mode === 'target'
      ? '每日目标'
      : mode === 'food'
        ? '饮食记录'
        : mode === 'body'
          ? '身体数据'
          : mode === 'memory'
            ? '更正长期记忆'
            : '饮水记录';
  const field = (k: string, label: string, numeric = false) => (
    <Field
      key={k}
      label={label}
      value={form[k]}
      numeric={numeric}
      onChangeText={(v: string) => set(k, v)}
    />
  );
  return (
    <Screen>
      <Text style={ui.title}>{title}</Text>
      <Text style={ui.muted}>
        {entity ? '更正保留修订，并重新计算余额。' : '空白营养值表示未知。'}
      </Text>
      {!!error && <Text style={ui.error}>{error}</Text>}
      {mode === 'memory' ? (
        field('value', '记忆内容')
      ) : (
        <>
          {field(
            mode === 'target' ? 'effective_from' : 'local_date',
            mode === 'target' ? '生效日期 YYYY-MM-DD' : '发生日期 YYYY-MM-DD',
          )}
          {mode === 'water' && field('amount_ml', '饮水量 ml', true)}
          {mode === 'body' && (
            <>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {Object.entries(bodyLabels).map(([key, label]) => (
                  <Pressable
                    key={key}
                    onPress={() => set('metric', key)}
                    style={[
                      ui.chip,
                      form.metric === key && {
                        borderWidth: 1,
                        borderColor: colors.green,
                      },
                    ]}
                  >
                    <Text style={ui.text}>{String(label)}</Text>
                  </Pressable>
                ))}
              </View>
              {field('value', bodyLabels[form.metric], true)}
            </>
          )}
          {mode === 'food' && (
            <>
              {field('name', '食品名称')}
              <View style={ui.row}>
                <Button
                  title="准确 · 标签"
                  secondary={form.source !== 'label'}
                  onPress={() => set('source', 'label')}
                />
                <Button
                  title="估算 · 描述"
                  secondary={form.source !== 'estimate'}
                  onPress={() => set('source', 'estimate')}
                />
              </View>
              {form.source === 'label' && (
                <Card>
                  <Text style={ui.section}>标签基准与实际食用量</Text>
                  <View style={ui.row}>
                    {['g', 'ml', 'serving'].map((unit) => (
                      <Button
                        key={unit}
                        title={unit === 'serving' ? '份' : unit}
                        secondary={form.basis_unit !== unit}
                        onPress={() => set('basis_unit', unit)}
                      />
                    ))}
                  </View>
                  {field(
                    'basis_quantity',
                    '标签对应量 ' + form.basis_unit,
                    true,
                  )}
                  {field(
                    'consumed_quantity',
                    '实际食用量 ' + form.basis_unit,
                    true,
                  )}
                  <Text style={ui.muted}>
                    下方填写标签基准量营养值，服务端按食用量计算。
                  </Text>
                </Card>
              )}
              {form.source === 'estimate' &&
                field('assumptions', '份量与估算依据，例如熟米饭约 150g')}
            </>
          )}
          {mode === 'target' &&
            field('water_ml', '饮水目标 ml（空白为未设置）', true)}
          {(mode === 'target' || mode === 'food') &&
            keys.map((k, i) => field(k, labels[i] + '（空白为未知）', true))}
          {mode !== 'target' && field('note', '备注（可选）')}
          {mode === 'target' && (
            <Button
              secondary
              title={history ? '已允许历史修正' : '需要修改历史目标时点此允许'}
              onPress={() => setHistory(!history)}
            />
          )}
        </>
      )}
      {!draft && (
        <Button
          title={
            saving ? '保存中…' : mode === 'target' ? '生成目标草案' : '保存记录'
          }
          disabled={saving || !a.credentials || (!!id && !entity)}
          onPress={save}
        />
      )}
      {!!id && !entity && (
        <Button
          title="重新加载原记录"
          secondary
          onPress={() => {
            setDirty(false);
            setAttempt((n) => n + 1);
          }}
        />
      )}
      {draft && (
        <Card>
          <Text style={ui.section}>确认每日目标</Text>
          <Text style={ui.muted}>
            {draft.effective_from} 起 · 水 {draft.water_ml ?? '—'}ml · 热量{' '}
            {draft.calories_kcal ?? '—'}kcal{'\n'}碳水 {draft.carbs_g ?? '—'}g /
            蛋白质 {draft.protein_g ?? '—'}g / 脂肪 {draft.fat_g ?? '—'}g
          </Text>
          <Button
            title="确认并启用目标"
            disabled={saving}
            onPress={async () => {
              setSaving(true);
              try {
                await submission.mutate('/targets/' + draft.id + '/confirm', {
                  expected_version: draft.version,
                });
                submission.complete();
                router.back();
              } catch (e: any) {
                setError(e.message);
              } finally {
                setSaving(false);
              }
            }}
          />
        </Card>
      )}
      {entity && mode !== 'target' && mode !== 'memory' && (
        <Button
          title="撤销这条记录"
          secondary
          disabled={saving}
          onPress={async () => {
            try {
              await submission.mutate('/records/' + entity.id + '/undo', {
                expected_version: entity.version,
              });
              submission.complete();
              router.back();
            } catch (e: any) {
              setError(e.message);
            }
          }}
        />
      )}
    </Screen>
  );
}
