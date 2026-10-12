import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { CalendarDays } from 'lucide-react-native';
import { router } from 'expo-router';
import { Screen, Card, Heading, Button } from '../../components/ui';
import { PlanEditor } from '../../components/PlanEditor';
import { useApp } from '../../state/app';
import { useSubmission } from '../../state/use-submission';
import { ui, colors } from '../../theme';
import { planOverviewText } from '@fitmind/contracts/plan-overview';
export default function Plans() {
  const a = useApp();
  const submission = useSubmission();
  const [editing, setEditing] = useState(false);
  return (
    <Screen>
      <Heading title="训练计划" sub="为下一次，做好准备。" />
      {a.plans.map((p) => (
        <Card key={p.id}>
          <Text style={ui.eyebrow}>
            {p.status === 'active'
              ? '已确认'
              : p.status === 'draft'
                ? '待确认'
                : '已取消'}{' '}
            · v{p.version}
          </Text>
          <Text style={ui.section}>{p.name}</Text>
          <Text style={ui.muted}>{planOverviewText(p)}</Text>
          <Button
            secondary
            title="查看计划"
            onPress={() =>
              router.push({ pathname: '/plan/[id]', params: { id: p.id } })
            }
          />
        </Card>
      ))}
      {!a.plans.length && (
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
            <CalendarDays size={22} color={colors.green} strokeWidth={1.5} />
          </View>
          <Text style={ui.section}>你的下一次训练，从这里开始</Text>
          <Text style={ui.muted}>
            还没有计划。可以通过底部对话与教练制定，或手动填写。
          </Text>
          <View style={ui.line} />
          <Text style={ui.muted}>确认后，会在训练前一晚提醒你。</Text>
        </Card>
      )}
      <Button
        title={editing ? '收起编辑器' : '创建训练计划'}
        disabled={!a.credentials}
        onPress={() => setEditing(!editing)}
      />
      {editing && (
        <PlanEditor
          date={a.context?.local_date}
          onSave={async (input: any) => {
            const p = await submission.mutate('/plans/drafts', input);
            setEditing(false);
            submission.complete();
            router.push({ pathname: '/plan/[id]', params: { id: p.id } });
          }}
        />
      )}
    </Screen>
  );
}
