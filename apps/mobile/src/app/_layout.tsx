import React from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from '../state/app';
import { colors } from '../theme';
import { NotificationObserver } from '../native/NotificationObserver';
export default function Root() {
  return (
    <SafeAreaProvider style={{ backgroundColor: colors.bg }}>
      <AppProvider>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{
            flex: 1,
            backgroundColor: colors.bg,
            width: '100%',
            maxWidth: 520,
            alignSelf: 'center',
          }}
        >
          <StatusBar style="light" />
          <NotificationObserver />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.bg },
              headerTintColor: colors.text,
              headerTitleStyle: { fontSize: 16 },
              headerBackTitle: '返回',
              headerShadowVisible: false,
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="settings" options={{ title: '连接与设置' }} />
            <Stack.Screen name="editor" options={{ title: '编辑记录' }} />
            <Stack.Screen name="chat" options={{ title: 'AI 教练' }} />
            <Stack.Screen name="capture" options={{ title: '图片与语音' }} />
            <Stack.Screen name="plan/[id]" options={{ title: '训练计划' }} />
            <Stack.Screen name="day/[id]" options={{ title: '训练日详情' }} />
            <Stack.Screen
              name="workout/[id]"
              options={{ title: '训练进行中' }}
            />
          </Stack>
        </KeyboardAvoidingView>
      </AppProvider>
    </SafeAreaProvider>
  );
}
