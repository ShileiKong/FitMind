import React from 'react';
import {
  View,
  TextInput,
  Pressable,
  Text,
  ActivityIndicator,
  Platform,
} from 'react-native';
import {
  Camera,
  Mic,
  ArrowUp,
  Sparkles,
  ChevronRight,
} from 'lucide-react-native';
import { router } from 'expo-router';
import { useApp } from '../state/app';
import { ui, colors } from '../theme';
export function ChatComposer() {
  const a = useApp();
  return (
    <View
      style={{
        paddingHorizontal: 12,
        paddingTop: 12,
        paddingBottom: 8,
        gap: 6,
      }}
    >
      <View style={ui.between}>
        <View style={[ui.row, { gap: 6, paddingLeft: 8 }]}>
          <Sparkles size={12} color={colors.green} strokeWidth={1.5} />
          <Text style={{ ...ui.muted, fontSize: 10 }}>
            AI 教练 ·{' '}
            {a.capabilities?.demo
              ? '演示模式'
              : a.capabilities?.text
                ? '已接入'
                : '等待 API'}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="查看对话"
          onPress={() => router.push('/chat')}
          style={{
            minHeight: 28,
            justifyContent: 'center',
            paddingHorizontal: 8,
          }}
        >
          <View style={{ ...ui.row, gap: 2 }}>
            <Text style={{ ...ui.muted, fontSize: 10 }}>查看对话</Text>
            <ChevronRight size={12} color={colors.muted} />
          </View>
        </Pressable>
      </View>
      <View
        style={[
          ui.row,
          {
            backgroundColor: '#030C07',
            borderColor: '#00ED8526',
            borderWidth: 1,
            borderRadius: 24,
            paddingLeft: 16,
            paddingRight: 5,
            gap: 0,
          },
        ]}
      >
        <TextInput
          accessibilityLabel="给 AI 教练发消息"
          multiline
          value={a.draft}
          onChangeText={a.setDraft}
          placeholder="和教练说说，刚刚的一组…"
          placeholderTextColor={colors.muted}
          style={{
            flex: 1,
            minHeight: 52,
            maxHeight: 110,
            paddingVertical: 12,
            color: colors.text,
            fontSize: 12,
            lineHeight: 18,
            ...(Platform.OS === 'web' ? { scrollbarWidth: 'none' } : {}),
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="发送消息"
          disabled={a.busy || !a.draft.trim() || !a.credentials}
          onPress={() => {
            void a.send().catch(() => {});
          }}
          style={({ pressed }) => ({
            minWidth: 44,
            minHeight: 48,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              backgroundColor:
                !a.draft.trim() || a.busy || !a.credentials
                  ? colors.greenSoft
                  : colors.green,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {a.busy ? (
              <ActivityIndicator color={colors.green} size="small" />
            ) : (
              <ArrowUp
                size={16}
                color={
                  !a.draft.trim() || !a.credentials ? colors.green : '#001A0D'
                }
                strokeWidth={2}
              />
            )}
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="拍照或选图"
          onPress={() => router.push('/capture')}
          style={({ pressed }) => ({
            minWidth: 44,
            minHeight: 48,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Camera size={18} color={colors.muted} strokeWidth={1.5} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="语音输入"
          onPress={() =>
            router.push({ pathname: '/capture', params: { mode: 'voice' } })
          }
          style={({ pressed }) => ({
            minWidth: 44,
            minHeight: 48,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Mic size={18} color={colors.text} strokeWidth={1.5} />
        </Pressable>
      </View>
    </View>
  );
}
