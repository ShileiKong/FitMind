import React from 'react';
import { Pressable, Text } from 'react-native';
import { router } from 'expo-router';
import { useApp } from '../state/app';
import { ui, colors } from '../theme';
export function SyncBanner() {
  const a = useApp();
  if (!a.offline && !a.pendingInputs.length) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="查看待同步输入"
      onPress={() => router.push('/sync')}
      style={[ui.card, { padding: 12, borderColor: colors.green }]}
    >
      <Text style={ui.muted}>
        {a.offline ? '离线 · 显示最近缓存数据' : '连接正常'} ·{' '}
        {a.pendingInputs.length} 条输入待同步
      </Text>
      <Text style={ui.muted}>待同步输入尚未计入额度。查看与重试 ↗</Text>
    </Pressable>
  );
}
