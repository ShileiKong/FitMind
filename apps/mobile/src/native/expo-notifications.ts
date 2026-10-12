import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { NotificationAdapter, type NotificationPort } from './notifications';
import type { ReminderSpec } from '@fitmind/contracts';
if (Platform.OS !== 'web')
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
export const notificationPort: NotificationPort = {
  permission: async () =>
    Platform.OS === 'web'
      ? 'web_preview'
      : (await Notifications.getPermissionsAsync()).status,
  list: async () =>
    Platform.OS === 'web'
      ? []
      : (await Notifications.getAllScheduledNotificationsAsync())
          .filter((n) => n.content.data?.fitmind === true)
          .map((n) => ({
            id: n.identifier,
            spec: n.content.data?.spec as unknown as ReminderSpec,
          })),
  cancel: async (id) => {
    if (Platform.OS !== 'web')
      await Notifications.cancelScheduledNotificationAsync(id);
  },
  schedule: async (s) =>
    Notifications.scheduleNotificationAsync({
      content: {
        title: s.title,
        body: s.body,
        sound: 'default',
        data: {
          fitmind: true,
          workout_day_id: s.workout_day_id,
          plan_version: s.plan_version,
          spec: s,
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(s.fire_at_utc),
      },
    }),
  limit: 60,
};
export const notifications = new NotificationAdapter(notificationPort);
export async function requestNotificationPermission() {
  if (Platform.OS === 'web') return 'web_preview';
  return (await Notifications.requestPermissionsAsync()).status;
}
export async function clearPlanNotifications() {
  for (const old of await notificationPort.list())
    await notificationPort.cancel(old.id);
}
