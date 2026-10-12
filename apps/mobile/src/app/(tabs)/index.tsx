import React from 'react';
import { SyncBanner } from '../../components/SyncBanner';
import { View, Text, Pressable, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import {
  Droplets,
  Flame,
  Plus,
  ArrowUpRight,
  Settings2,
  Dumbbell,
  Utensils,
  Activity,
  ChevronRight,
} from 'lucide-react-native';
import { useApp } from '../../state/app';
import { Screen, Card, Button, Heading, Loading } from '../../components/ui';
import { BudgetCard } from '../../components/BudgetCard';
import { ui, colors } from '../../theme';
export default function Home() {
  const a = useApp();
  const { fontScale } = useWindowDimensions();
  const budgetDirection = fontScale > 1.3 ? 'column' : 'row';
  const today = a.context?.local_date;
  const day = a.days.find((d) => d.local_date === today);
  return (
    <Screen>
      <Heading
        title="今日"
        sub={
          today ? today + ' · ' + a.context.timezone : '连接个人后端，开始记录'
        }
        action={
          <Pressable
            accessibilityLabel="连接设置"
            onPress={() => router.push('/settings')}
            accessibilityRole="button"
            style={{
              padding: 13,
              borderRadius: 24,
              backgroundColor: '#07130C',
              borderWidth: 1,
              borderColor: '#00ED8524',
            }}
          >
            <Settings2 color={colors.text} size={19} strokeWidth={1.5} />
          </Pressable>
        }
      />
      {!a.ready && <Loading />}
      {!a.credentials && (
        <Card>
          <Text style={ui.section}>你的身体数据，从这里开始</Text>
          <Text style={ui.muted}>
            连接自己的后端后，记录、目标和训练计划会持续保存。
          </Text>
          <Button
            title="连接个人后端"
            onPress={() => router.push('/settings')}
          />
        </Card>
      )}
      {!!a.error && <Text style={ui.error}>{a.error}</Text>}
      <SyncBanner />
      <View style={ui.between}>
        <View style={{ gap: 3 }}>
          <Text style={ui.section}>每日目标</Text>
          <Text style={{ ...ui.muted, fontSize: 11 }}>今日剩余额度</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="调整目标"
          style={{ minHeight: 44, justifyContent: 'center' }}
          onPress={() =>
            router.push({ pathname: '/editor', params: { mode: 'target' } })
          }
        >
          <View style={{ ...ui.row, gap: 3 }}>
            <Text style={{ ...ui.muted, color: colors.green }}>调整目标</Text>
            <ChevronRight size={13} color={colors.green} />
          </View>
        </Pressable>
      </View>
      <View style={{ flexDirection: budgetDirection, gap: 10 }}>
        <BudgetCard
          label="饮水"
          unit="ml"
          large
          budget={a.summary?.water_ml}
          icon={<Droplets size={15} color={colors.green} strokeWidth={1.5} />}
        />
        <BudgetCard
          label="热量"
          unit="kcal"
          large
          budget={a.summary?.calories_kcal}
          icon={<Flame size={15} color={colors.green} strokeWidth={1.5} />}
        />
      </View>
      <View style={{ flexDirection: budgetDirection, gap: 8 }}>
        {[
          ['碳水', 'carbs_g'],
          ['蛋白质', 'protein_g'],
          ['脂肪', 'fat_g'],
        ].map(([label, key]) => (
          <BudgetCard
            key={key}
            label={label}
            unit="g"
            budget={(a.summary as any)?.[key]}
          />
        ))}
      </View>
      <View style={ui.row}>
        {[
          ['饮水', 'water'],
          ['饮食', 'food'],
          ['身体', 'body'],
        ].map(([title, mode]) => (
          <Pressable
            key={mode}
            accessibilityRole="button"
            accessibilityLabel={'记录' + title}
            onPress={() =>
              router.push({ pathname: '/editor', params: { mode } })
            }
            style={[
              ui.secondary,
              {
                flex: 1,
                minHeight: 46,
                borderRadius: 18,
                flexDirection: 'row',
                gap: 6,
                alignItems: 'center',
                justifyContent: 'center',
              },
            ]}
          >
            {mode === 'water' ? (
              <Droplets size={16} color={colors.green} strokeWidth={1.5} />
            ) : mode === 'food' ? (
              <Utensils size={16} color={colors.green} strokeWidth={1.5} />
            ) : (
              <Activity size={16} color={colors.green} strokeWidth={1.5} />
            )}
            <Text style={{ ...ui.text, fontSize: 13 }}>{title}</Text>
            <Plus size={11} color={colors.muted} />
          </Pressable>
        ))}
      </View>
      <Card>
        <View style={ui.between}>
          <View style={ui.row}>
            <Dumbbell color={colors.green} size={18} strokeWidth={1.5} />
            <Text style={ui.section}>今日训练</Text>
          </View>
          <ArrowUpRight color={colors.muted} size={17} strokeWidth={1.5} />
        </View>
        <Text style={{ ...ui.text, fontSize: 19 }}>
          {day?.name ?? '今天还没有训练安排'}
        </Text>
        <Text style={ui.muted}>
          {day
            ? day.exercises
                .map((e: any) => e.name + ' ' + e.sets + '组')
                .join(' / ')
            : '在计划页制定计划，或让 AI 教练一起安排。'}
        </Text>
        <Button
          title={day ? '查看训练计划' : '制定训练计划'}
          secondary
          onPress={() =>
            router.push(
              day
                ? { pathname: '/plan/[id]', params: { id: day.plan_id } }
                : '/(tabs)/plans',
            )
          }
        />
      </Card>
      <View style={ui.between}>
        <Text style={ui.section}>今日记录</Text>
        <Text style={ui.muted}>{a.records.length} 条</Text>
      </View>
      {!a.records.length && (
        <Text style={ui.muted}>尚无记录。通过上方按钮或底部对话输入。</Text>
      )}
      {a.records.map((r) => (
        <Pressable
          key={r.id}
          accessibilityRole="button"
          onPress={() =>
            router.push({
              pathname: '/editor',
              params: { mode: r.kind, id: r.id },
            })
          }
          style={[ui.card, { padding: 14 }]}
        >
          <View style={ui.between}>
            <Text style={ui.text}>
              {r.kind === 'water'
                ? r.amount_ml + ' ml 水'
                : r.kind === 'food'
                  ? r.name
                  : r.metric + ' · ' + r.value}
            </Text>
            <Text style={{ ...ui.muted, color: colors.green }}>更正 ↗</Text>
          </View>
          {r.kind === 'food' && (
            <Text style={ui.muted}>
              {r.source === 'estimate' ? '约 ' : ''}
              {r.nutrition.calories_kcal ?? '未知'} kcal · 蛋白质{' '}
              {r.nutrition.protein_g ?? '未知'} g
            </Text>
          )}
        </Pressable>
      ))}
    </Screen>
  );
}
