import React, { useState } from 'react';
import { Text, Platform } from 'react-native';
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  AudioModule,
  setAudioModeAsync,
} from 'expo-audio';
import { randomUUID } from 'expo-crypto';
import { Card, Button } from './ui';
import { ui } from '../theme';
import type { LocalAttachment } from '../native/images';
export function VoiceDraft({ onRecorded, onError }: any) {
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    directory: 'document',
  });
  const state = useAudioRecorderState(recorder);
  const [busy, setBusy] = useState(false);
  async function start() {
    setBusy(true);
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted)
        throw new Error('没有麦克风权限，可以继续文字输入');
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function stop(cancel = false) {
    setBusy(true);
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      if (!cancel && recorder.uri) {
        const id = randomUUID();
        let uri = recorder.uri;
        if (Platform.OS === 'web') {
          const blob = await (await fetch(uri)).blob();
          uri = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        }
        const attachment: LocalAttachment = {
          uri,
          kind: 'audio',
          mime_type: Platform.OS === 'web' ? 'audio/webm' : 'audio/mp4',
          name: id + (Platform.OS === 'web' ? '.webm' : '.m4a'),
          idempotency_key: id,
        };
        await onRecorded(attachment);
      }
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <Text style={ui.section}>语音记录</Text>
      <Text style={ui.muted}>
        停止录音后先转写，编辑文字并发送后才记录数据。
      </Text>
      {state.isRecording ? (
        <>
          <Text style={ui.big}>{Math.floor(state.durationMillis / 1000)}s</Text>
          <Button
            title="停止并保留录音"
            disabled={busy}
            onPress={() => stop()}
          />
          <Button
            secondary
            title="取消本次录音"
            disabled={busy}
            onPress={() => stop(true)}
          />
        </>
      ) : (
        <Button title="开始录音" disabled={busy} onPress={start} />
      )}
    </Card>
  );
}
