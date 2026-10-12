import React, { useState } from 'react';
import { Text } from 'react-native';
import { router } from 'expo-router';
import { Screen, Card, Button } from '../components/ui';
import { useApp } from '../state/app';
import { ui } from '../theme';
export default function Sync() {
  const a = useApp();
  const [busy, setBusy] = useState(false);
  return (
    <Screen>
      <Text style={ui.title}>待同步输入</Text>
      <Text style={ui.muted}>
        这里的输入暂未确认提交，已保存余额以服务端回执为准。
      </Text>
      {a.pendingInputs.map((p) => (
        <Card key={p.idempotency_key}>
          <Text style={ui.text}>
            {p.body.text ??
              (p.body.kind === 'water'
                ? p.body.amount_ml + ' ml 水'
                : (p.body.name ?? '数据操作'))}
          </Text>
          <Text style={ui.muted}>
            采集日 {p.capture_local_date} · {p.capture_timezone}
          </Text>
          {p.last_error && <Text style={ui.error}>{p.last_error.message}</Text>}
          <Button
            title="查看服务器记录"
            secondary
            onPress={() => router.push('/(tabs)')}
          />
          <Button
            title="移除这条待同步输入"
            secondary
            onPress={() => {
              void a.removePending(p.idempotency_key);
            }}
          />
        </Card>
      ))}
      {!a.pendingInputs.length && (
        <Text style={ui.muted}>没有待同步输入。</Text>
      )}
      <Button
        title={busy ? '同步中…' : '重试同步并刷新回执'}
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          try {
            await a.refresh();
          } finally {
            setBusy(false);
          }
        }}
      />
    </Screen>
  );
}
