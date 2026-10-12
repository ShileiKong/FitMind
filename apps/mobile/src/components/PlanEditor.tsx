import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { Card, Field, Button } from './ui';
import { ui, colors } from '../theme';
export function shiftDate(date: string, delta: number) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
const ex = () => ({
  exercise_id: randomUUID(),
  name: '',
  variant: '',
  equipment: '',
  load_convention: 'total',
  weight_kg: null,
  increment_kg: null,
  sets: 3,
  reps_min: 8,
  reps_max: 12,
  rest_seconds: 90,
});
export function PlanEditor({ initial, date, onSave }: any) {
  const [name, setName] = useState(initial?.name ?? ''),
    [days, setDays] = useState<any[]>(
      initial?.days.map((d: any) => ({
        id: d.id,
        name: d.name,
        local_date: d.local_date,
        exercises: d.exercises,
      })) ?? [
        {
          name: '训练日 A',
          local_date: date ? shiftDate(date, 1) : '',
          exercises: [ex()],
        },
      ],
    ),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  function changeDay(i: number, key: string, v: any) {
    setDays((ds) => ds.map((d, j) => (j === i ? { ...d, [key]: v } : d)));
  }
  function changeEx(i: number, j: number, key: string, v: any) {
    setDays((ds) =>
      ds.map((d, idx) =>
        idx === i
          ? {
              ...d,
              exercises: d.exercises.map((e: any, n: number) =>
                n === j ? { ...e, [key]: v } : e,
              ),
            }
          : d,
      ),
    );
  }
  return (
    <View style={{ gap: 16 }}>
      <Field label="计划名称" value={name} onChangeText={setName} />
      {days.map((d, i) => (
        <Card key={d.id ?? i}>
          <Field
            label={'训练日 ' + (i + 1) + ' 名称'}
            value={d.name}
            onChangeText={(v: string) => changeDay(i, 'name', v)}
          />
          <Field
            label={'训练日 ' + (i + 1) + ' 日期 YYYY-MM-DD'}
            value={d.local_date}
            onChangeText={(v: string) => changeDay(i, 'local_date', v)}
          />
          {d.exercises.map((e: any, j: number) => (
            <View
              key={e.exercise_id}
              style={{
                gap: 8,
                borderTopWidth: 1,
                borderColor: colors.border,
                paddingTop: 14,
              }}
            >
              <Text style={ui.section}>动作 {j + 1}</Text>
              {[
                ['name', '动作名称'],
                ['variant', '动作变式（如杠铃平板）'],
                ['equipment', '器械（如杠铃）'],
              ].map(([k, label]) => (
                <Field
                  key={k}
                  label={label}
                  value={e[k]}
                  onChangeText={(v: string) => changeEx(i, j, k, v)}
                />
              ))}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {[
                  ['total', '总重'],
                  ['per_hand', '每只手'],
                  ['bodyweight', '自重'],
                  ['machine', '器械刻度'],
                ].map(([k, label]) => (
                  <Button
                    key={k}
                    title={label}
                    secondary={e.load_convention !== k}
                    onPress={() => changeEx(i, j, 'load_convention', k)}
                  />
                ))}
              </View>
              {[
                ['sets', '计划组数'],
                ['reps_min', '目标最少次数'],
                ['reps_max', '目标最多次数'],
                ['weight_kg', '计划重量 kg（可留空）'],
                ['increment_kg', '调整步长 kg（可留空）'],
                ['rest_seconds', '组间休息 秒'],
              ].map(([k, label]) => (
                <Field
                  key={k}
                  label={label}
                  numeric
                  value={e[k] == null ? '' : String(e[k])}
                  onChangeText={(v: string) =>
                    changeEx(i, j, k, v === '' ? null : Number(v))
                  }
                />
              ))}
              {d.exercises.length > 1 && (
                <Button
                  title="移除此动作"
                  secondary
                  onPress={() =>
                    changeDay(
                      i,
                      'exercises',
                      d.exercises.filter((_: any, n: number) => n !== j),
                    )
                  }
                />
              )}
            </View>
          ))}
          <Button
            secondary
            title="添加动作"
            onPress={() => changeDay(i, 'exercises', [...d.exercises, ex()])}
          />
          {days.length > 1 && (
            <Button
              title="移除此训练日"
              secondary
              onPress={() => setDays((ds) => ds.filter((_, n) => n !== i))}
            />
          )}
        </Card>
      ))}
      <Button
        secondary
        title="添加训练日"
        onPress={() =>
          setDays((ds) => [
            ...ds,
            {
              name: '训练日 ' + (ds.length + 1),
              local_date: date ? shiftDate(date, ds.length + 1) : '',
              exercises: [ex()],
            },
          ])
        }
      />
      {!!error && <Text style={ui.error}>{error}</Text>}
      <Button
        title={busy ? '保存中…' : initial ? '保存计划修改' : '生成计划草案'}
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          try {
            await onSave({ name, days });
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </View>
  );
}
