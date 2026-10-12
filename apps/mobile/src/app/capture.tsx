import React, { useEffect, useState } from 'react';
import { View, Text, Image } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useApp } from '../state/app';
import { useSubmission } from '../state/use-submission';
import { Screen, Card, Field, Button } from '../components/ui';
import { VoiceDraft } from '../components/VoiceDraft';
import { ImageAdapter, type LocalAttachment } from '../native/images';
import { uploadLocal } from '../native/uploads';
import { CacheStore } from '../storage/cache';
import { ui } from '../theme';
export default function Capture() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const a = useApp();
  const submission = useSubmission();
  const [file, setFile] = useState<LocalAttachment | null>(null),
    [description, setDescription] = useState(''),
    [analysis, setAnalysis] = useState<any>(null),
    [analysisMode, setAnalysisMode] = useState('meal'),
    [amount, setAmount] = useState(''),
    [values, setValues] = useState<any>({
      calories_kcal: '',
      carbs_g: '',
      protein_g: '',
      fat_g: '',
    }),
    [basis, setBasis] = useState(''),
    [unit, setUnit] = useState('g'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (a.scope)
      void CacheStore.get<any>('media-draft.' + a.scope).then((d) => {
        if (d) {
          setFile(d.file);
          setDescription(d.description ?? '');
        }
        setHydrated(true);
      });
  }, [a.scope]);
  useEffect(() => {
    if (a.scope && hydrated)
      void CacheStore.set('media-draft.' + a.scope, {
        file,
        description,
      }).catch(() => setError('无法保存本地草稿，请检查设备存储空间'));
  }, [a.scope, hydrated, file, description]);
  async function pick(source: 'camera' | 'library') {
    setError('');
    try {
      const img = await new ImageAdapter().pick(source);
      if (img) {
        setFile(img);
        setAnalysis(null);
      }
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function transcribe() {
    if (!file) return;
    setBusy(true);
    try {
      const m = await uploadLocal(a.api, file);
      setFile({ ...file, asset_id: m.id });
      const r = (
        await a.api.request(
          'POST',
          '/audio/transcriptions',
          { asset_id: m.id },
          {
            idempotency_key: file.idempotency_key + ':text',
            timeout_ms: 35000,
          },
        )
      ).data;
      a.setDraft(r.text);
      setDescription(r.text);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function analyze() {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const asset = await uploadLocal(a.api, file);
      setFile({ ...file, asset_id: asset.id });
      const result = (
        await a.api.request(
          'POST',
          '/nutrition/analyze',
          { asset_id: asset.id, mode: analysisMode, description },
          {
            idempotency_key: file.idempotency_key + ':analyze',
            timeout_ms: 35000,
          },
        )
      ).data;
      setAnalysis(result);
      setValues(
        Object.fromEntries(
          Object.entries(result.nutrition).map(([k, v]) => [
            k,
            v === null ? '' : String(v),
          ]),
        ),
      );
      setBasis(
        result.basis_quantity == null ? '' : String(result.basis_quantity),
      );
      setUnit(result.basis_unit ?? 'g');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function saveFood() {
    setBusy(true);
    try {
      const nutrition = Object.fromEntries(
        Object.entries(values).map(([k, v]) => [
          k,
          String(v).trim() === '' ? null : Number(v),
        ]),
      );
      const payload: any = {
        kind: 'food',
        name: analysis.name,
        local_date: a.context?.local_date,
        source: analysis.type === 'label_draft' ? 'label' : 'estimate',
        nutrition,
        attachment_ids: [file?.asset_id],
      };
      if (payload.source === 'label')
        payload.label = {
          basis_quantity: Number(basis),
          basis_unit: unit,
          consumed_quantity: Number(amount),
          consumed_unit: unit,
          nutrition_per_basis: nutrition,
        };
      else payload.assumptions = analysis.assumptions;
      await submission.mutate('/records', payload);
      await CacheStore.remove('media-draft.' + a.scope);
      submission.complete();
      router.back();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      <Text style={ui.title}>
        {mode === 'voice' ? '把表现，说出来。' : '记录这一次摄入。'}
      </Text>
      <Text style={ui.muted}>
        先预览和核对。失败时保留本地输入，可以重新上传。
      </Text>
      {!!error && <Text style={ui.error}>{error}</Text>}
      {mode === 'voice' ? (
        <VoiceDraft
          onError={setError}
          onRecorded={async (f: LocalAttachment) => {
            setFile(f);
            await CacheStore.set('media-draft.' + a.scope, {
              file: f,
              description: '',
            });
          }}
        />
      ) : (
        <View style={{ gap: 10 }}>
          <Button title="拍照" secondary onPress={() => pick('camera')} />
          <Button title="从相册选图" onPress={() => pick('library')} />
        </View>
      )}
      {file && (
        <Card>
          {file.kind === 'image' ? (
            <Image
              source={{ uri: file.uri }}
              style={{ height: 230, width: '100%', borderRadius: 8 }}
              resizeMode="contain"
            />
          ) : (
            <Text style={ui.section}>录音已保留 · 等待转写或重试</Text>
          )}
          <Text style={ui.muted}>
            {file.asset_id ? '附件已上传' : '附件暂存本地，尚未计入数据'}
          </Text>
          <Field
            label={
              file.kind === 'audio' ? '转写文字（可编辑）' : '食物与份量描述'
            }
            value={description}
            multiline
            onChangeText={setDescription}
          />
          {file.kind === 'audio' ? (
            <>
              <Button
                title="转写这段录音"
                disabled={busy || !a.credentials}
                onPress={transcribe}
              />
              <Button
                title="使用这段文字，返回对话"
                secondary
                onPress={() => {
                  a.setDraft(description);
                  submission.complete();
                  router.back();
                }}
              />
            </>
          ) : (
            <>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button
                  title="餐食估算"
                  secondary={analysisMode !== 'meal'}
                  onPress={() => setAnalysisMode('meal')}
                />
                <Button
                  title="营养标签"
                  secondary={analysisMode !== 'label'}
                  onPress={() => setAnalysisMode('label')}
                />
              </View>
              <Button
                title={busy ? '解析中…' : '解析图片，先核对结果'}
                disabled={busy || !a.credentials}
                onPress={analyze}
              />
              <Button
                title="连同描述发给 AI 教练"
                secondary
                disabled={busy || a.busy || !a.credentials}
                onPress={async () => {
                  try {
                    await a.send(
                      description ||
                        '请查看这张食物图片，先核对份量和营养再记录',
                      { local_attachments: [file] },
                    );
                    router.push('/chat');
                  } catch (e: any) {
                    setError(e.message);
                  }
                }}
              />
            </>
          )}
          <Button
            title="移除本地附件"
            secondary
            disabled={busy}
            onPress={async () => {
              setFile(null);
              setAnalysis(null);
              await CacheStore.remove('media-draft.' + a.scope);
            }}
          />
        </Card>
      )}
      {analysis && (
        <Card>
          <Text style={ui.section}>
            {analysis.name} ·{' '}
            {analysis.type === 'label_draft'
              ? '标签草案'
              : analysis.type === 'estimated_food'
                ? '估算草案'
                : '需要补充信息'}
          </Text>
          {analysis.question && (
            <Text style={ui.muted}>{analysis.question}</Text>
          )}
          {analysis.assumptions && (
            <Text style={ui.muted}>{analysis.assumptions}</Text>
          )}
          {analysis.type !== 'needs_input' && (
            <>
              <Text style={ui.muted}>空白为未知，请校正后再保存。</Text>
              {Object.entries(values).map(([k, v]) => (
                <Field
                  key={k}
                  label={
                    (
                      {
                        calories_kcal: '能量 kcal',
                        carbs_g: '碳水 g',
                        protein_g: '蛋白质 g',
                        fat_g: '脂肪 g',
                      } as any
                    )[k]
                  }
                  numeric
                  value={v}
                  onChangeText={(text: string) =>
                    setValues((old: any) => ({ ...old, [k]: text }))
                  }
                />
              ))}
              {analysis.type === 'label_draft' && (
                <>
                  <Field
                    label="标签对应量"
                    numeric
                    value={basis}
                    onChangeText={setBasis}
                  />
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {['g', 'ml', 'serving'].map((u) => (
                      <Button
                        key={u}
                        title={u === 'serving' ? '份' : u}
                        secondary={unit !== u}
                        onPress={() => setUnit(u)}
                      />
                    ))}
                  </View>
                  <Field
                    label="实际食用量"
                    numeric
                    value={amount}
                    onChangeText={setAmount}
                  />
                </>
              )}
              <Button
                title="已核对，保存饮食记录"
                disabled={busy}
                onPress={saveFood}
              />
            </>
          )}
        </Card>
      )}
    </Screen>
  );
}
