import { useEffect } from 'react';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useApp } from '../state/app';
import { notifications } from './expo-notifications';
import { handleResponse } from './notification-routing';
import { randomUUID } from 'expo-crypto';
import { syncReminderStatus, reminderNotice } from './reminder-status';
export function NotificationObserver() {
  const { api, credentials, setError, plans, profile, setReminderStatus } =
    useApp();
  const connected = !!credentials;
  useEffect(() => {
    if (!connected || Platform.OS === 'web') return;
    let alive = true;
    const used = new Set<string>();
    const redirect = async (r: Notifications.NotificationResponse | null) => {
      if (!r || !alive || used.has(r.notification.request.identifier)) return;
      used.add(r.notification.request.identifier);
      try {
        const d = await handleResponse(
          api,
          r.notification.request.content.data,
        );
        if (alive)
          router.push({ pathname: '/day/[id]', params: { id: d.day_id } });
      } catch {
        if (alive) setError('无法读取通知对应的最新计划，请连接后重试');
      }
    };
    void Notifications.getLastNotificationResponseAsync().then(redirect);
    const listener = Notifications.addNotificationResponseReceivedListener(
      (r) => {
        void redirect(r);
      },
    );
    return () => {
      alive = false;
      listener.remove();
    };
  }, [api, connected, setError]);
  useEffect(() => {
    if (!connected) return;
    let alive = true;
    const sync = async () => {
      try {
        await syncReminderStatus(
          api,
          notifications,
          (result) => {
            if (!alive) return;
            setReminderStatus(result);
            if (result.failed.length) setError(reminderNotice(result));
          },
          Platform.OS !== 'web',
          randomUUID,
        );
      } catch {
        if (alive) setError('提醒同步失败，联网后会重试');
      }
    };
    void Promise.resolve().then(sync);
    return () => {
      alive = false;
    };
  }, [api, connected, plans, profile, setError, setReminderStatus]);
  return null;
}
