import React from 'react';
import { View, Text } from 'react-native';
import { Screen } from '../components/ui';
import { MessageList } from '../components/MessageList';
import { ChatComposer } from '../components/ChatComposer';
import { useApp } from '../state/app';
import { ui } from '../theme';
export default function Chat() {
  const a = useApp();
  return (
    <View style={ui.page}>
      <Screen>
        {!!a.error && <Text style={ui.error}>{a.error}</Text>}
        <MessageList />
      </Screen>
      <ChatComposer />
    </View>
  );
}
