import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Tabs } from 'expo-router';
import {
  LayoutDashboard,
  CalendarDays,
  Dumbbell,
  UserRound,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChatComposer } from '../../components/ChatComposer';
import { ui, colors } from '../../theme';
const icons: any = {
  index: LayoutDashboard,
  plans: CalendarDays,
  training: Dumbbell,
  profile: UserRound,
};
export default function Layout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={({ state, descriptors, navigation }) => (
        <View
          style={{
            backgroundColor: '#020805',
            paddingBottom: insets.bottom,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            borderTopWidth: 1,
            borderColor: '#00ED851C',
            paddingHorizontal: 8,
          }}
        >
          <ChatComposer />
          <View
            style={{
              flexDirection: 'row',
              paddingHorizontal: 4,
              paddingBottom: 4,
            }}
          >
            {state.routes.map((route, index) => {
              const active = index === state.index;
              const Icon = icons[route.name] ?? UserRound;
              return (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityLabel={String(
                    descriptors[route.key].options.title,
                  )}
                  accessibilityState={{ selected: active }}
                  key={route.key}
                  onPress={() => navigation.navigate(route.name)}
                  style={{
                    flex: 1,
                    minHeight: 64,
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 3,
                  }}
                >
                  <View
                    style={{
                      width: 46,
                      height: 30,
                      borderRadius: 15,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: active
                        ? colors.greenSoft
                        : 'transparent',
                    }}
                  >
                    <Icon
                      color={active ? colors.green : colors.muted}
                      size={19}
                      strokeWidth={active ? 1.8 : 1.5}
                    />
                  </View>
                  <Text
                    style={{
                      ...ui.muted,
                      fontSize: 10,
                      fontWeight: active ? '600' : '400',
                      color: active ? colors.green : colors.muted,
                    }}
                  >
                    {descriptors[route.key].options.title}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
    >
      <Tabs.Screen name="index" options={{ title: '今日' }} />
      <Tabs.Screen name="plans" options={{ title: '计划' }} />
      <Tabs.Screen name="training" options={{ title: '训练' }} />
      <Tabs.Screen name="profile" options={{ title: '我的' }} />
    </Tabs>
  );
}
