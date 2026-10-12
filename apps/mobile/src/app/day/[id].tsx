import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen, Card, Button, Loading } from '../../components/ui';
import { useApp } from '../../state/app';
import { useSubmission } from '../../state/use-submission';
import { ui } from '../../theme';
export default function Day() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const a = useApp();
  const submission = useSubmission();
  const [d, setD] = useState<any>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void a.api
      .request('GET', '/workout-days/' + id)
      .then((r) => setD(r.data))
      .catch((e) => setError(e.message));
  }, [id, a.api, a.plans]);
  return (
    <Screen>
      {!!error && <Text style={ui.error}>{error}</Text>}
      {!d ? (
        <Loading />
      ) : (
        <>
          <Text style={ui.eyebrow}>
            {d.local_date} / v{d.plan_version}
          </Text>
          <Text style={ui.title}>{d.name}</Text>
          {d.status === 'cancelled' ? (
            <Card>
              <Text style={ui.section}>这个训练日已取消</Text>
              <Text style={ui.muted}>你打开的是旧提醒，当前状态已经更新。</Text>
            </Card>
          ) : (
            <>
              {d.exercises.map((e: any) => (
                <Card key={e.exercise_id}>
                  <Text style={ui.section}>{e.name}</Text>
                  <Text style={ui.muted}>
                    {e.variant} · {e.equipment}
                    {'\n'}
                    {e.sets} 组 × {e.reps_min}–{e.reps_max} 次 ·{' '}
                    {e.weight_kg ?? '待定'} kg{'\n'}步长{' '}
                    {e.increment_kg ?? '未知'} kg · 休息 {e.rest_seconds} 秒
                  </Text>
                </Card>
              ))}
              <Button
                title="开始这次训练"
                disabled={busy || d.status !== 'active'}
                onPress={async () => {
                  setBusy(true);
                  try {
                    const w = await submission.mutate('/workout-sessions', {
                      workout_day_id: d.id,
                    });
                    submission.complete();
                    router.push({
                      pathname: '/workout/[id]',
                      params: { id: w.id },
                    });
                  } catch (e: any) {
                    setError(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </>
          )}
          <Button
            title="查看或修改完整计划"
            secondary
            onPress={() =>
              router.push({ pathname: '/plan/[id]', params: { id: d.plan_id } })
            }
          />
        </>
      )}
    </Screen>
  );
}
