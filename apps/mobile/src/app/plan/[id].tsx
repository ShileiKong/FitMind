import React, { useState, useEffect } from 'react';
import { Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Screen, Button, Loading } from '../../components/ui';
import { PlanEditor } from '../../components/PlanEditor';
import { PlanSchedule } from '../../components/PlanSchedule';
import { useApp } from '../../state/app';
import { useSubmission } from '../../state/use-submission';
import { ui } from '../../theme';
export default function Plan() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const a = useApp();
  const submission = useSubmission();
  const [p, setP] = useState<any>(null),
    [error, setError] = useState(''),
    [loadError, setLoadError] = useState(''),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void a.api
      .request('GET', '/plans/' + id)
      .then((r) => {
        setP(r.data);
        setLoadError('');
      })
      .catch((e) => setLoadError(e.message));
  }, [id, a.api, a.plans]);
  async function action(name: string) {
    setBusy(true);
    setError('');
    try {
      const next = await submission.mutate('/plans/' + id + '/' + name, {
        expected_version: p.version,
      });
      setP(next);
      submission.complete();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      {!!(error || loadError) && <Text style={ui.error}>{error || loadError}</Text>}
      {!p ? (
        <Loading />
      ) : (
        <>
          <Text style={ui.title}>{p.name}</Text>
          <Text style={ui.muted}>
            {p.status === 'draft'
              ? '待确认草案'
              : p.status === 'active'
                ? '已确认计划'
                : '计划已取消'}{' '}
            · 版本 {p.version}
          </Text>
          <PlanSchedule plan={p} today={a.context?.local_date} />
          {p.status === 'draft' && (
            <Button
              title="确认并启用计划"
              disabled={busy}
              onPress={() => action('confirm')}
            />
          )}
          {p.status !== 'cancelled' && (
            <>
              <Button
                title={editing ? '收起修改' : '修改动作或训练日期'}
                secondary
                onPress={() => setEditing(!editing)}
              />
              {editing && (
                <PlanEditor
                  initial={p}
                  date={a.context?.local_date}
                  onSave={async (input: any) => {
                    const next = await submission.mutate(
                      '/plans/' + id,
                      { expected_version: p.version, patch: input },
                      'PATCH',
                    );
                    setP(next);
                    submission.complete();
                    setEditing(false);
                  }}
                />
              )}
              <Button
                title="取消计划与提醒"
                secondary
                disabled={busy}
                onPress={() => action('cancel')}
              />
            </>
          )}
        </>
      )}
    </Screen>
  );
}
