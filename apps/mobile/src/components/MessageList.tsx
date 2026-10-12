import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { useApp } from '../state/app';
import { colors, ui } from '../theme';
import { Button } from './ui';
import {
  agentErrorText,
  proposalPreview,
  receiptText,
  replyPreview,
} from './chat-presentation';

function AssistantReply({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const reply = replyPreview(text);
  if (!reply.full) return null;
  return (
    <View style={{ gap: 8 }}>
      <Text style={ui.text}>{expanded ? reply.full : reply.preview}</Text>
      {reply.hasDetails && (
        <Button
          title={expanded ? '收起详情' : '展开详情'}
          secondary
          onPress={() => setExpanded(!expanded)}
        />
      )}
    </View>
  );
}
export function MessageList() {
  const a = useApp();
  return (
    <View style={{ gap: 16 }}>
      {!a.messages.length && (
        <Text style={ui.muted}>
          从一条记录开始。你可以说“喝了 300 毫升水”，或“卧推 40 公斤 10
          次，有些吃力”。
        </Text>
      )}
      {a.messages.map((m) => (
        <View key={m.message_id} style={{ gap: 8 }}>
          <View
            style={[
              ui.card,
              {
                backgroundColor: colors.raised,
                alignSelf: 'flex-end',
                maxWidth: '92%',
              },
            ]}
          >
            <Text style={ui.text}>{m.text}</Text>
            <Text style={ui.muted}>
              {m.created_at?.slice(0, 16).replace('T', ' ')} UTC
            </Text>
          </View>
          {m.result && (
            <View style={ui.card}>
              <Text style={ui.eyebrow}>
                FitMind ·{' '}
                {m.result.status === 'completed' ? '教练' : '回复未完成'}
              </Text>
              {!m.result.error && (
                <AssistantReply text={m.result.assistant_text} />
              )}
              {m.result.record_receipts?.map((r: any, i: number) => (
                <Text key={i} style={{ ...ui.muted, color: colors.green }}>
                  {receiptText(r)}
                </Text>
              ))}
              {[
                ...new Set<string>([
                  ...(m.result.tool_errors ?? []).map(agentErrorText),
                  ...(m.result.error ? [agentErrorText(m.result.error)] : []),
                ]),
              ].map((text, i) => (
                <Text key={i} style={ui.error}>
                  {text}
                </Text>
              ))}
              {m.result.proposals?.map((p: any) => (
                <View key={p.id} style={{ gap: 8 }}>
                  <Text style={ui.text}>
                    待确认 · {p.type === 'target' ? '每日目标' : p.name}
                  </Text>
                  <Text style={ui.muted}>{proposalPreview(p)}</Text>
                  <Button
                    title="查看草案"
                    secondary
                    onPress={() =>
                      router.push(
                        p.type === 'target'
                          ? {
                              pathname: '/editor',
                              params: { mode: 'target', id: p.id },
                            }
                          : { pathname: '/plan/[id]', params: { id: p.id } },
                      )
                    }
                  />
                </View>
              ))}
              {m.result.error?.retryable && (
                <Button
                  title="恢复这条消息"
                  secondary
                  onPress={() => {
                    void a
                      .mutate('/messages/' + m.message_id + '/recover', {})
                      .catch((e) => a.setError(e.message));
                  }}
                />
              )}
            </View>
          )}
        </View>
      ))}
    </View>
  );
}
