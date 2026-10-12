import React, { useEffect, useState } from 'react';
import { View, Text, Switch } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useApp } from '../../state/app';
import { useSubmission } from '../../state/use-submission';
import { Screen, Card, Field, Button, Loading } from '../../components/ui';
import { ChatComposer } from '../../components/ChatComposer';
import { CacheStore } from '../../storage/cache';
import { RestTimer } from '../../native/rest-timer';
import { ui, colors } from '../../theme';
const reasons: any = {
  HOLD: '保持当前重量，优先完成目标次数',
  REDUCE_LOAD: '这组吃力且未达到目标，下组减少一个步长',
  INCREASE_LOAD: '已轻松达到目标上限，下组增加一个步长',
  PAIN_PAUSE: '出现疼痛，训练已暂停，请先评估是否继续',
  UNKNOWN_ACTUAL_LOAD: '缺少实际重量，请补充后再给出重量建议',
  UNKNOWN_INCREMENT: '调整步长未知，先保持重量',
  TWO_SUCCESSES: '连续两次可比训练完成目标，可以考虑下次加重',
};
export default function Workout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const a = useApp();
  const submission = useSubmission();
  const [w, setW] = useState<any>(
      () => a.sessions.find((s) => s.id === id) ?? null,
    ),
    [recs, setRecs] = useState<any[]>([]),
    [weight, setWeight] = useState(''),
    [reps, setReps] = useState(''),
    [difficulty, setDifficulty] = useState('normal'),
    [rpe, setRpe] = useState(''),
    [pain, setPain] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [edit, setEdit] = useState<any>(null),
    [end, setEnd] = useState<number>(0),
    [now, setNow] = useState(() => Date.now());
  const [dateCorrection, setDateCorrection] = useState('');
  useEffect(() => {
    const cached = a.sessions.find((s) => s.id === id);
    let alive = true;
    void Promise.resolve().then(() => {
      if (alive && cached) setW(cached);
    });
    const load = async () => {
      const current = (await a.api.request('GET', '/workout-sessions/' + id))
        .data;
      const recommendations = (
        await a.api.request('GET', '/recommendations?session_id=' + id)
      ).data;
      if (alive) {
        setW(current);
        setRecs(recommendations);
      }
    };
    void load().catch((e) => {
      if (alive) {
        setRecs([]);
        setError(cached ? '离线显示缓存；新输入将保存到待同步。' : e.message);
      }
    });
    return () => {
      alive = false;
    };
  }, [id, a.api, a.sessions]);
  useEffect(() => {
    void CacheStore.get<number>('rest.' + id).then((t) => setEnd(t ?? 0));
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [id]);
  const p = w?.snapshot.exercises.find(
    (e: any) => e.exercise_id === (edit?.exercise_id ?? w.current_exercise_id),
  );
  const recommendation = recs.find(
    (r) =>
      r.exercise_id === w?.current_exercise_id &&
      r.type === 'next_set' &&
      r.status !== 'invalidated',
  );
  async function transition(action: string, exercise_id?: string) {
    setBusy(true);
    try {
      const next = await submission.mutate(
        '/workout-sessions/' + id + '/transition',
        {
          expected_version: w.version,
          action,
          ...(exercise_id ? { exercise_id } : {}),
          ...(action === 'change_date' ? { local_date: dateCorrection } : {}),
        },
      );
      setW(next);
      submission.complete();
      setEdit(null);
      setWeight('');
      setReps('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setError('');
    try {
      if (!reps.trim()) throw new Error('请填写这一组实际完成次数');
      const input: any = {
        weight_kg: weight.trim() === '' ? null : Number(weight),
        reps: Number(reps),
        difficulty,
        rpe: rpe.trim() === '' ? null : Number(rpe),
        pain,
      };
      if (edit) {
        await submission.mutate(
          '/workout-sets/' + edit.id,
          { expected_version: edit.version, patch: input },
          'PATCH',
        );
        setEdit(null);
      } else {
        const result = await submission.mutate(
          '/workout-sessions/' + id + '/sets',
          {
            exercise_id: w.current_exercise_id,
            ...input,
          },
        );
        setW(result.session);
        submission.complete();
        setWeight('');
        setReps('');
        setRpe('');
        setPain(false);
        const restStarted = Date.now();
        const nextEnd = restStarted + p.rest_seconds * 1000;
        setNow(restStarted);
        setEnd(nextEnd);
        await CacheStore.set('rest.' + id, nextEnd).catch(() =>
          setError('组已保存，休息计时未能缓存'),
        );
      }
      submission.complete();
      setWeight('');
      setReps('');
      setRpe('');
      setPain(false);
      setRecs(
        (
          await a.api
            .request('GET', '/recommendations?session_id=' + id)
            .catch(() => ({ data: [] }))
        ).data,
      );
      setWeight('');
      setReps('');
      setRpe('');
      setPain(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={ui.page}>
      <Screen>
        {!!error && <Text style={ui.error}>{error}</Text>}
        {!w ? (
          <Loading />
        ) : (
          <>
            <Text style={ui.eyebrow}>
              {w.local_date} /{' '}
              {w.status === 'active' ? 'IN PROGRESS' : w.status.toUpperCase()}
            </Text>
            <Text style={ui.title}>{w.snapshot.name}</Text>
            <Field
              label="整场训练日期更正（YYYY-MM-DD）"
              value={dateCorrection}
              placeholder={w.local_date}
              onChangeText={setDateCorrection}
            />
            <Button
              title="更正整场归属日期"
              secondary
              disabled={busy || !dateCorrection}
              onPress={() => transition('change_date')}
            />
            <Text style={ui.muted}>
              已保存 {w.sets.length} 组 · 当前 {p?.name}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {w.snapshot.exercises.map((e: any) => (
                <Button
                  key={e.exercise_id}
                  title={e.name}
                  secondary={w.current_exercise_id !== e.exercise_id}
                  disabled={busy || !['active', 'paused'].includes(w.status)}
                  onPress={() => transition('switch', e.exercise_id)}
                />
              ))}
            </View>
            {['active', 'paused'].includes(w.status) && (
              <>
                <Card>
                  <Text style={ui.section}>
                    {edit ? '更正实际组' : '记录这一组'} · {p?.name}
                  </Text>
                  <Text style={ui.muted}>
                    计划 {p?.weight_kg ?? '待定'}kg × {p?.reps_min}–
                    {p?.reps_max}次 ·{' '}
                    {p?.load_convention === 'per_hand'
                      ? '每只手'
                      : '动作指定重量记法'}
                    {'\n'}下方填写实际表现；空白重量保持未知。
                  </Text>
                  <View style={ui.row}>
                    <View style={{ flex: 1 }}>
                      <Field
                        label="实际重量 kg"
                        numeric
                        value={weight}
                        onChangeText={setWeight}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field
                        label="实际次数"
                        numeric
                        value={reps}
                        onChangeText={setReps}
                      />
                    </View>
                  </View>
                  <View style={ui.row}>
                    {[
                      ['easy', '轻松'],
                      ['normal', '适中'],
                      ['hard', '吃力'],
                    ].map(([key, label]) => (
                      <Button
                        key={key}
                        title={label}
                        secondary={difficulty !== key}
                        onPress={() => setDifficulty(key)}
                      />
                    ))}
                  </View>
                  <Field
                    label="RPE 1–10（可选）"
                    numeric
                    value={rpe}
                    onChangeText={setRpe}
                  />
                  <View style={ui.between}>
                    <Text style={ui.text}>出现疼痛</Text>
                    <Switch
                      value={pain}
                      onValueChange={setPain}
                      trackColor={{ true: colors.danger }}
                    />
                  </View>
                  <Button
                    title={busy ? '保存中…' : edit ? '保存更正' : '保存实际组'}
                    disabled={busy || (w.status === 'paused' && !edit)}
                    onPress={save}
                  />
                  {!edit &&
                    a.pendingInputs.some(
                      (item) =>
                        item.idempotency_key === submission.key &&
                        item.path.endsWith('/sets') &&
                        item.last_error?.retryable !== false,
                    ) && (
                      <>
                        <Text style={ui.muted}>
                          这一组已暂存到待同步，尚未计入实际组数；联网后使用原编号提交。
                        </Text>
                        <Button
                          title="已暂存，记录新的一组"
                          secondary
                          onPress={() => {
                            submission.complete();
                            setWeight('');
                            setReps('');
                            setRpe('');
                            setPain(false);
                          }}
                        />
                      </>
                    )}
                  {edit && (
                    <Button
                      secondary
                      title="取消更正"
                      onPress={() => {
                        setEdit(null);
                        setWeight('');
                        setReps('');
                      }}
                    />
                  )}
                </Card>
                {recommendation && (
                  <Card>
                    <Text style={ui.eyebrow}>NEXT SET / 仅为建议</Text>
                    <Text style={ui.section}>
                      {recommendation.weight_kg ?? '待补充'} kg ×{' '}
                      {recommendation.reps_min}–{recommendation.reps_max} 次
                    </Text>
                    <Text style={ui.muted}>
                      {reasons[recommendation.reason_code] ??
                        recommendation.reason_code}
                    </Text>
                  </Card>
                )}
                {end > 0 && (
                  <Card>
                    <Text style={ui.muted}>组间休息</Text>
                    <Text style={ui.big}>
                      {new RestTimer(end).remaining(now)}s
                    </Text>
                    <Button
                      secondary
                      title="结束休息"
                      onPress={() => {
                        setEnd(0);
                        void CacheStore.set('rest.' + id, 0);
                      }}
                    />
                  </Card>
                )}
                <View style={ui.row}>
                  <Button
                    title={w.status === 'paused' ? '恢复训练' : '暂停训练'}
                    secondary
                    disabled={busy}
                    onPress={() =>
                      transition(w.status === 'paused' ? 'resume' : 'pause')
                    }
                  />
                  <Button
                    title="跳过当前动作"
                    secondary
                    disabled={busy}
                    onPress={() => transition('skip')}
                  />
                </View>
                <Button
                  title="完成这次训练"
                  disabled={busy}
                  onPress={() => transition('complete')}
                />
                <Button
                  title="结束并保留已记录的组"
                  secondary
                  disabled={busy}
                  onPress={() => transition('abandon')}
                />
              </>
            )}
            <Text style={ui.section}>实际组记录</Text>
            {!w.sets.length && (
              <Text style={ui.muted}>
                尚未记录实际组。也可以在底部直接告诉教练刚刚的表现。
              </Text>
            )}
            {w.sets.map((s: any, i: number) => (
              <Card key={s.id}>
                <Text style={ui.text}>
                  {i + 1}.{' '}
                  {
                    w.snapshot.exercises.find(
                      (e: any) => e.exercise_id === s.exercise_id,
                    )?.name
                  }{' '}
                  · {s.weight_kg ?? '重量未知'} kg × {s.reps} 次
                </Text>
                <Text style={ui.muted}>
                  {s.difficulty === 'hard'
                    ? '吃力'
                    : s.difficulty === 'easy'
                      ? '轻松'
                      : '难度 ' + (s.difficulty ?? '未填')}{' '}
                  {s.rpe ? '· RPE ' + s.rpe : ''} {s.pain ? '· 疼痛' : ''}
                </Text>
                <View style={ui.row}>
                  <Button
                    secondary
                    title="更正这组"
                    onPress={() => {
                      setEdit(s);
                      setWeight(s.weight_kg == null ? '' : String(s.weight_kg));
                      setReps(String(s.reps));
                      setDifficulty(s.difficulty ?? 'normal');
                      setRpe(s.rpe == null ? '' : String(s.rpe));
                      setPain(!!s.pain);
                    }}
                  />
                  <Button
                    secondary
                    title="撤销这组"
                    onPress={async () => {
                      try {
                        await submission.mutate(
                          '/workout-sets/' + s.id + '/undo',
                          {
                            expected_version: s.version,
                          },
                        );
                        submission.complete();
                        setRecs(
                          (
                            await a.api.request(
                              'GET',
                              '/recommendations?session_id=' + id,
                            )
                          ).data,
                        );
                      } catch (e: any) {
                        setError(e.message);
                      }
                    }}
                  />
                </View>
                {edit?.id === s.id &&
                  !['active', 'paused'].includes(w.status) && (
                    <>
                      <Field
                        label="更正实际重量 kg"
                        numeric
                        value={weight}
                        onChangeText={setWeight}
                      />
                      <Field
                        label="更正实际次数"
                        numeric
                        value={reps}
                        onChangeText={setReps}
                      />
                      <Button title="保存更正" disabled={busy} onPress={save} />
                    </>
                  )}
              </Card>
            ))}
            {recs
              .filter(
                (r) => r.type === 'next_workout' && r.status === 'proposed',
              )
              .map((r) => (
                <Card key={r.id}>
                  <Text style={ui.section}>下次训练建议</Text>
                  <Text style={ui.muted}>
                    {reasons[r.reason_code]} · {r.weight_kg} kg{'\n'}
                    确认后才更新该计划的未来训练日。
                  </Text>
                  <Button
                    title="接受未来计划调整"
                    disabled={busy}
                    onPress={async () => {
                      try {
                        await submission.mutate(
                          '/recommendations/' + r.id + '/accept',
                          {
                            expected_version: r.version,
                          },
                        );
                        submission.complete();
                        setRecs(
                          (
                            await a.api.request(
                              'GET',
                              '/recommendations?session_id=' + id,
                            )
                          ).data,
                        );
                      } catch (e: any) {
                        setError(e.message);
                      }
                    }}
                  />
                </Card>
              ))}
          </>
        )}
      </Screen>
      <ChatComposer />
    </View>
  );
}
