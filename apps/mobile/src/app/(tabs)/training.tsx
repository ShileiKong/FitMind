import React from 'react';
import { Text, View } from 'react-native';
import { Dumbbell } from 'lucide-react-native';
import { router } from 'expo-router';
import { Screen, Card, Heading, Button } from '../../components/ui';
import { useApp } from '../../state/app';
import { ui, colors } from '../../theme';
export default function Training() {
  const a = useApp();
  return (
    <Screen>
      <Heading title="训练" sub="每一组，都让进步更清晰。" />
      {!a.sessions.length && (
        <Card>
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 16,
              backgroundColor: colors.greenSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Dumbbell size={22} color={colors.green} strokeWidth={1.5} />
          </View>
          <Text style={ui.section}>还没有训练记录</Text>
          <Text style={ui.muted}>
            先在计划页确认训练日，开始后即可逐组记录。
          </Text>
          <Button
            title="查看训练计划"
            secondary
            onPress={() => router.push('/(tabs)/plans')}
          />
        </Card>
      )}
      {a.sessions.map((w) => (
        <Card key={w.id}>
          <Text style={ui.eyebrow}>
            {w.local_date} /{' '}
            {w.status === 'active'
              ? '进行中'
              : w.status === 'paused'
                ? '已暂停'
                : w.status === 'completed'
                  ? '已完成'
                  : '已结束'}
          </Text>
          <Text style={ui.section}>{w.snapshot.name}</Text>
          <Text style={ui.muted}>
            已记录 {w.sets.length} 组 ·{' '}
            {w.sets.reduce((sum, s) => sum + s.reps, 0)} 次
          </Text>
          <Button
            title={
              ['active', 'paused'].includes(w.status)
                ? '继续这次训练'
                : '查看实际表现'
            }
            secondary
            onPress={() =>
              router.push({ pathname: '/workout/[id]', params: { id: w.id } })
            }
          />
        </Card>
      ))}
    </Screen>
  );
}
