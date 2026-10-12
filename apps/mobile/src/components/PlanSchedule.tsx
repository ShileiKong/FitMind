import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import type { PlanView, WorkoutDay } from '@fitmind/contracts';
import {
  formatPlanDate,
  formatPlanPeriod,
  planOverview,
} from '@fitmind/contracts/plan-overview';
import { Card, Button } from './ui';
import { ui } from '../theme';

function Exercises({ day }: { day: WorkoutDay }) {
  return (
    <>
      {day.exercises.map((e) => (
        <View key={e.exercise_id} style={{ gap: 4 }}>
          <Text style={ui.text}>
            {e.name} · {e.sets} 组 ×{' '}
            {e.reps_min === e.reps_max
              ? e.reps_min
              : `${e.reps_min}–${e.reps_max}`}{' '}
            次
          </Text>
          <Text style={ui.muted}>
            {e.weight_kg == null ? '重量待定' : `${e.weight_kg} 公斤`} ·{' '}
            {
              {
                per_hand: '每只手',
                total: '总重',
                bodyweight: '自重',
                machine: '器械刻度',
              }[e.load_convention]
            }{' '}
            · 休息 {e.rest_seconds} 秒
          </Text>
        </View>
      ))}
    </>
  );
}
export function PlanSchedule({
  plan,
  today,
}: {
  plan: PlanView;
  today?: string;
}) {
  const [showDates, setShowDates] = useState(false);
  const view = planOverview(plan);
  const dates = [...plan.days].sort((a, b) =>
    a.local_date.localeCompare(b.local_date),
  );
  const next = today
    ? dates.find((d) => d.local_date >= today && d.status === 'active')
    : undefined;
  return (
    <>
      <Text style={ui.section}>
        {formatPlanPeriod(view.period.start_date, view.period.end_date)}
      </Text>
      <Text style={ui.muted}>
        {view.total} 个训练日 ·{' '}
        {view.weekly.length ? '按每周安排查看' : '按日期安排'}
      </Text>
      {view.weekly.map((block) => (
        <Card key={block.days[0].id}>
          <Text style={ui.eyebrow}>
            {block.label} · {block.days.length} 次
          </Text>
          <Text style={ui.section}>{block.days[0].name}</Text>
          {!block.entire_period && (
            <Text style={ui.muted}>
              {formatPlanPeriod(block.start_date, block.end_date)}
            </Text>
          )}
          <Exercises day={block.days[0]} />
        </Card>
      ))}
      {!!view.single.length && !!view.weekly.length && (
        <Text style={ui.section}>{view.single.length} 个单独安排</Text>
      )}
      {view.single.map((day) => (
        <Card key={day.id}>
          <Text style={ui.eyebrow}>{formatPlanDate(day.local_date, true)}</Text>
          <Text style={ui.section}>{day.name}</Text>
          <Exercises day={day} />
          {plan.status === 'active' && (
            <Button
              title="查看这个训练日"
              secondary
              onPress={() =>
                router.push({ pathname: '/day/[id]', params: { id: day.id } })
              }
            />
          )}
        </Card>
      ))}
      {next && (
        <Button
          title={`查看下一次训练 · ${formatPlanDate(next.local_date)}`}
          onPress={() =>
            router.push({ pathname: '/day/[id]', params: { id: next.id } })
          }
        />
      )}
      {!!view.weekly.length && (
        <Button
          secondary
          title={
            showDates ? '收起具体日期' : `按日期查看 · ${view.total} 个训练日`
          }
          onPress={() => setShowDates(!showDates)}
        />
      )}
      {showDates &&
        dates.map((day) => (
          <Card key={'date-' + day.id}>
            <Text style={ui.eyebrow}>
              {formatPlanDate(day.local_date, true)}
            </Text>
            <Text style={ui.text}>{day.name}</Text>
            {plan.status === 'active' && (
              <Button
                title="查看这个训练日"
                secondary
                onPress={() =>
                  router.push({ pathname: '/day/[id]', params: { id: day.id } })
                }
              />
            )}
          </Card>
        ))}
    </>
  );
}
