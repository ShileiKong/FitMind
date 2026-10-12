import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { router } from 'expo-router';
import { useApp } from '../../state/app';
import { Screen, Card, Button, Heading } from '../../components/ui';
import { ui, colors } from '../../theme';
export default function Profile() {
  const a = useApp();
  const [points, setPoints] = useState<any[]>([]);
  useEffect(() => {
    if (a.credentials)
      void a.api
        .request('GET', '/trends?metric=weight_kg')
        .then((r) => setPoints(r.data.points))
        .catch(() => {});
  }, [a.api, a.credentials, a.records]);
  const latest = points.at(-1);
  return (
    <Screen>
      <Heading title="我的身体档案" sub="真实记录，持续认识自己" />
      <Card>
        <Text style={ui.eyebrow}>身体数据</Text>
        <Text style={ui.muted}>最近体重</Text>
        <View style={ui.row}>
          <Text style={ui.big}>{latest?.value ?? '—'}</Text>
          <Text style={ui.muted}>kg</Text>
        </View>
        <Text style={ui.muted}>{latest?.local_date ?? '还没有身体数据'}</Text>
        <Button
          secondary
          title="记录身体数据"
          onPress={() =>
            router.push({ pathname: '/editor', params: { mode: 'body' } })
          }
        />
      </Card>
      <Card>
        <Text style={ui.section}>体重变化</Text>
        {!points.length && (
          <Text style={ui.muted}>保存体重后，会按发生日期展示趋势。</Text>
        )}
        {points.slice(-8).map((p) => (
          <View key={p.id} style={ui.between}>
            <Text style={ui.muted}>{p.local_date}</Text>
            <View
              style={{
                flex: 1,
                maxWidth: 150,
                height: 5,
                backgroundColor: colors.raised,
              }}
            >
              <View
                style={{
                  width: (Math.min(100, (p.value / 150) * 100) + '%') as any,
                  height: 5,
                  backgroundColor: colors.green,
                }}
              />
            </View>
            <Text style={{ ...ui.text, fontVariant: ['tabular-nums'] }}>
              {p.value} kg
            </Text>
          </View>
        ))}
      </Card>
      <Card>
        <Text style={ui.section}>目标版本</Text>
        {!a.targets.length && (
          <Text style={ui.muted}>与 AI 对话设定，或手动创建每日目标。</Text>
        )}
        {a.targets.slice(0, 6).map((t) => (
          <View key={t.id} style={{ gap: 6 }}>
            <Text style={ui.text}>
              {t.effective_from} 起 · {t.calories_kcal ?? '—'} kcal ·{' '}
              {t.status === 'active'
                ? '生效'
                : t.status === 'draft'
                  ? '草案'
                  : '历史版本'}
            </Text>
            {t.status === 'draft' && (
              <Button
                secondary
                title="查看并确认"
                onPress={() =>
                  router.push({
                    pathname: '/editor',
                    params: { mode: 'target', id: t.id },
                  })
                }
              />
            )}
          </View>
        ))}
        <Button
          title="设置每日目标"
          secondary
          onPress={() =>
            router.push({ pathname: '/editor', params: { mode: 'target' } })
          }
        />
      </Card>
      <Card>
        <Text style={ui.section}>AI 长期记忆</Text>
        <Text style={ui.muted}>
          这里保存明确的习惯和偏好。更正或删除后，下次对话使用最新事实。
        </Text>
        {!a.memories.length && (
          <Text style={ui.muted}>可以告诉教练“记住：我更喜欢晚上训练”。</Text>
        )}
        {a.memories.map((m) => (
          <View key={m.id} style={{ gap: 8 }}>
            <Text style={ui.text}>{m.value}</Text>
            <Text style={ui.muted}>
              来源 {m.source_message_id} · v{m.version}
            </Text>
            <View style={ui.row}>
              <Button
                title="更正"
                secondary
                onPress={() =>
                  router.push({
                    pathname: '/editor',
                    params: { mode: 'memory', id: m.id },
                  })
                }
              />
              <Button
                title="删除记忆"
                secondary
                onPress={() => {
                  void a
                    .mutate('/memories/' + m.id + '/forget', {
                      expected_version: m.version,
                    })
                    .catch((e) => a.setError(e.message));
                }}
              />
            </View>
          </View>
        ))}
      </Card>
      <Button
        secondary
        title="连接、时区与提醒设置"
        onPress={() => router.push('/settings')}
      />
    </Screen>
  );
}
