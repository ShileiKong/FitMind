import React, { useState } from 'react';
import { NotificationSettings } from '../components/NotificationSettings';
import { Text, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { useApp } from '../state/app';
import { useSubmission } from '../state/use-submission';
import { Screen, Card, Field, Button } from '../components/ui';
import { colors, ui } from '../theme';
export default function Settings() {
  const a = useApp();
  const submission = useSubmission();
  const [url, setUrl] = useState(
      a.credentials?.base_url ?? 'http://127.0.0.1:8787',
    ),
    [token, setToken] = useState(a.credentials?.token ?? ''),
    [timezone, setTimezone] = useState(a.profile?.timezone ?? 'Asia/Shanghai'),
    [time, setTime] = useState(a.profile?.reminder_time ?? '21:00'),
    [enabled, setEnabled] = useState(a.profile?.notifications_enabled ?? true),
    [version, setVersion] = useState(a.profile?.version ?? 0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      <Text style={ui.title}>连接你的私人 Agent</Text>
      <Text style={ui.muted}>
        模型 API 配置在后端。手机只需要服务地址和个人访问令牌。
      </Text>
      {!!error && <Text style={ui.error}>{error}</Text>}
      <Card>
        <Field label="后端地址" value={url} onChangeText={setUrl} />
        <Text style={ui.muted}>
          网页本机使用 127.0.0.1；iPhone 请填写电脑的局域网 IP，并在同一 Wi-Fi
          下。
        </Text>
        <Field
          label="个人访问令牌"
          value={token}
          onChangeText={setToken}
          secure
        />
        <Button
          title={busy ? '连接中…' : '验证并保存连接'}
          disabled={busy}
          onPress={() =>
            run(async () => {
              if (!/^https?:\/\//.test(url.trim()) || !token.trim())
                throw new Error('请填写有效地址和令牌');
              await a.connect({ base_url: url.trim(), token: token.trim() });
              submission.complete();
              router.back();
            })
          }
        />
      </Card>
      {a.credentials && (
        <Card>
          <Text style={ui.section}>日期与提醒</Text>
          <Field
            label="时区（IANA）"
            value={timezone}
            onChangeText={setTimezone}
          />
          <Field label="前一晚提醒 HH:mm" value={time} onChangeText={setTime} />
          <View style={ui.between}>
            <Text style={ui.text}>训练计划通知</Text>
            <Switch
              value={enabled}
              onValueChange={setEnabled}
              trackColor={{ true: colors.green }}
            />
          </View>
          <Button
            title="保存日期与提醒设置"
            disabled={busy}
            onPress={() =>
              run(async () => {
                const saved = await submission.mutate(
                  '/profile',
                  {
                    expected_version: version,
                    timezone,
                    reminder_time: time,
                    notifications_enabled: enabled,
                  },
                  'PATCH',
                );
                setVersion(saved.version);
                submission.complete();
              })
            }
          />
          <Button
            title="读取最新设置"
            secondary
            disabled={busy}
            onPress={() =>
              run(async () => {
                const current = (await a.api.request('GET', '/profile')).data;
                setTimezone(current.timezone);
                setTime(current.reminder_time);
                setEnabled(current.notifications_enabled);
                setVersion(current.version);
                submission.complete();
              })
            }
          />
          <Button
            secondary
            title="断开连接"
            onPress={() =>
              run(async () => {
                await a.disconnect();
                submission.complete();
                router.back();
              })
            }
          />
        </Card>
      )}
      <NotificationSettings />
      <Card>
        <Text style={ui.section}>模型连接状态</Text>
        <Text style={ui.muted}>
          文字：
          {a.capabilities?.demo
            ? '演示'
            : a.capabilities?.text
              ? '已配置'
              : '未配置'}
          {'\n'}图片：{a.capabilities?.vision ? '已配置' : '未配置'}
          {'\n'}语音：{a.capabilities?.transcription ? '已配置' : '未配置'}
        </Text>
        <Text style={ui.muted}>
          未配置模型时，手动记录、目标和计划仍可使用。
        </Text>
      </Card>
    </Screen>
  );
}
