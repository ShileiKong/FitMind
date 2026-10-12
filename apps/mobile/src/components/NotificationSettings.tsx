import React, { useState, useEffect } from 'react';
import { Text, Platform } from 'react-native';
import { Card, Button } from './ui';
import { ui } from '../theme';
import {
  notificationPort,
  notifications,
  requestNotificationPermission,
} from '../native/expo-notifications';
import { useApp } from '../state/app';
import { reminderNotice } from '../native/reminder-status';
export function NotificationSettings() {
  const a = useApp();
  const [state, setState] = useState('读取权限…');
  useEffect(() => {
    void notificationPort
      .permission()
      .then((p) =>
        setState(
          p === 'web_preview'
            ? '网页预览不发送手机通知'
            : p === 'granted'
              ? '手机通知权限已开启'
              : '尚未获得手机通知权限',
        ),
      );
  }, []);
  return (
    <Card>
      <Text style={ui.section}>手机通知</Text>
      <Text style={ui.muted}>{state}</Text>
      {!!a.reminderStatus && (
        <Text style={a.reminderStatus.failed.length ? ui.error : ui.muted}>
          {reminderNotice(a.reminderStatus)}
        </Text>
      )}
      <Text style={ui.muted}>
        已确认计划将在前一晚提醒。改期和取消会在手机联网进入应用后同步。
      </Text>
      {Platform.OS !== 'web' && (
        <Button
          title="启用并同步手机通知"
          onPress={async () => {
            try {
              const p = await requestNotificationPermission();
              if (p !== 'granted') {
                setState('通知权限未开启，请在 iPhone 设置中允许');
                return;
              }
              const specs = (await a.api.request('GET', '/reminders')).data;
              const r = await notifications.reconcile(specs);
              a.setReminderStatus(r);
              setState(
                '已同步 · ' +
                  specs.length +
                  ' 个待提醒计划' +
                  (r.failed.length ? '，部分安排失败' : '') +
                  (r.deferred ? '，较远日期将随后同步' : ''),
              );
            } catch (e: any) {
              setState(e.message);
            }
          }}
        />
      )}
    </Card>
  );
}
