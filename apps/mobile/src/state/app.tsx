import { messageFingerprint } from './message-fingerprint';
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import { AppState } from 'react-native';
import {
  randomUUID,
  digestStringAsync,
  CryptoDigestAlgorithm,
} from 'expo-crypto';
import type {
  DailySummary,
  RecordView,
  Profile,
  PlanView,
  WorkoutSession,
  Memory,
} from '@fitmind/contracts';
import { ApiClient, ApiClientError } from '../api/client';
import { CredentialStore, type Credentials } from '../storage/credentials';
import { CacheStore } from '../storage/cache';
import { Outbox, type PendingInput } from '../storage/outbox';
import { prepareAttachments } from '../native/uploads';
import { captureTime } from './capture-time';
import { dashboardClock } from './dashboard-clock';
interface AppData {
  context: any;
  summary: DailySummary | null;
  records: RecordView[];
  profile: Profile | null;
  plans: PlanView[];
  days: any[];
  sessions: WorkoutSession[];
  memories: Memory[];
  targets: any[];
  messages: any[];
  capabilities: any;
}
const empty: AppData = {
  context: null,
  summary: null,
  records: [],
  profile: null,
  plans: [],
  days: [],
  sessions: [],
  memories: [],
  targets: [],
  messages: [],
  capabilities: null,
};
const Context = createContext<any>(null);
export function AppProvider({ children }: React.PropsWithChildren) {
  const [credentials, setCredentials] = useState<Credentials | null>(null),
    [ready, setReady] = useState(false),
    [data, setData] = useState<AppData>(empty),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [draft, setDraftState] = useState(''),
    [pending, setPending] = useState<any>(null),
    [outbox, setOutbox] = useState<Outbox | null>(null),
    [pendingInputs, setPendingInputs] = useState<PendingInput[]>([]),
    [offline, setOffline] = useState(false),
    [scope, setScope] = useState('');
  const [reminderStatus, setReminderStatus] = useState<any>(null);
  const serverOffset = useRef(0),
    refreshing = useRef(false),
    fresh = useRef(false),
    sending = useRef(false),
    draftRef = useRef(''),
    generation = useRef(0);
  const setDraft = useCallback((text: string) => {
    draftRef.current = text;
    setDraftState(text);
  }, []);
  const api = useMemo(
    () =>
      new ApiClient({
        base_url: credentials?.base_url ?? 'http://127.0.0.1:8787',
        getToken: async () => credentials?.token ?? '',
      }),
    [credentials],
  );
  useEffect(() => {
    CredentialStore.get()
      .then((c) => {
        setCredentials(c);
        setReady(true);
      })
      .catch(() => setReady(true));
  }, []);
  useEffect(() => {
    let alive = true;
    if (credentials) {
      void (async () => {
        const key = await digestStringAsync(
          CryptoDigestAlgorithm.SHA256,
          credentials.base_url + '|' + credentials.token,
        );
        const q = new Outbox(CacheStore, 'outbox.' + key, prepareAttachments);
        const cached = await CacheStore.get<any>('dashboard.' + key);
        const oldDraft = await CacheStore.get<string>('chat-draft.' + key);
        const oldPending = await CacheStore.get<any>('pending-chat.' + key);
        if (alive) {
          setScope(key);
          setOutbox(q);
          setPendingInputs(await q.list());
          if (cached && !fresh.current) {
            setData(cached.data);
            serverOffset.current = cached.calibration?.offset_ms ?? 0;
            setOffline(true);
          }
          if (oldDraft) setDraft(oldDraft);
          if (oldPending) setPending(oldPending);
        }
      })().catch((e) => setError(e.message));
    }
    return () => {
      alive = false;
    };
  }, [credentials, setDraft]);
  const refresh = useCallback(async () => {
    if (!credentials || refreshing.current) return;
    refreshing.current = true;
    const stamp = generation.current;
    try {
      let context = (await api.request('GET', '/context')).data;
      let calibration = dashboardClock(context, Date.now());
      if (stamp !== generation.current) return;
      serverOffset.current = calibration.offset_ms;
      if (outbox) {
        const sync = await outbox.flush(api);
        for (const done of sync.completed)
          if (
            done.path === '/chat' &&
            done.result?.status === 'completed' &&
            done.body.text === draftRef.current
          ) {
            setDraft('');
            setPending(null);
            if (scope) await CacheStore.remove('pending-chat.' + scope);
          }
        setPendingInputs(await outbox.list());
      }
      // Sync can take a minute and cross midnight or change the profile timezone.
      context = (await api.request('GET', '/context')).data;
      calibration = dashboardClock(context, Date.now());
      serverOffset.current = calibration.offset_ms;
      const paths = [
        '/days/' + context.local_date + '/summary',
        '/records?local_date=' + context.local_date + '&limit=100',
        '/profile',
        '/plans',
        '/workout-days',
        '/workout-sessions',
        '/memories',
        '/targets',
        '/messages',
        '/capabilities',
      ];
      const responses = await Promise.all(
        paths.map((p) => api.request('GET', p)),
      );
      const [
        summary,
        records,
        profile,
        plans,
        days,
        sessions,
        memories,
        targets,
        messages,
        capabilities,
      ] = responses.map((r) => r.data);
      const next = {
        context,
        summary,
        records: records.items,
        profile,
        plans,
        days,
        sessions,
        memories,
        targets,
        messages,
        capabilities,
      };
      if (stamp !== generation.current) return;
      fresh.current = true;
      setData(next);
      setOffline(false);
      setError('');
      if (scope)
        await CacheStore.set('dashboard.' + scope, {
          data: next,
          received_at: Date.now(),
          calibration,
        });
    } catch (e: any) {
      if (stamp === generation.current) {
        setOffline(true);
        setError(e.message);
        const meta = captureTime(
          data.profile?.timezone ?? 'Asia/Shanghai',
          new Date(Date.now() + serverOffset.current),
        );
        setData((old) =>
          old.context && old.context.local_date !== meta.capture_local_date
            ? {
                ...old,
                context: {
                  ...old.context,
                  local_date: meta.capture_local_date,
                },
                summary: null,
                records: [],
              }
            : old,
        );
      }
    } finally {
      refreshing.current = false;
    }
  }, [api, credentials, outbox, scope, setDraft, data.profile?.timezone]);
  useEffect(() => {
    void Promise.resolve().then(refresh);
    const timer = setInterval(() => void refresh(), 30000);
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      clearInterval(timer);
      listener.remove();
    };
  }, [refresh]);
  useEffect(() => {
    if (scope)
      void CacheStore.set('chat-draft.' + scope, draft).catch(() => {});
  }, [scope, draft]);
  async function connect(c: Credentials) {
    const candidate = new ApiClient({
      base_url: c.base_url,
      getToken: async () => c.token,
    });
    await candidate.request('GET', '/context');
    await CredentialStore.set(c);
    generation.current++;
    fresh.current = false;
    setOutbox(null);
    setScope('');
    setData(empty);
    setPendingInputs([]);
    setPending(null);
    setDraft('');
    setCredentials(c);
    setReminderStatus(null);
  }
  function capture() {
    return captureTime(
      data.profile?.timezone ?? 'Asia/Shanghai',
      new Date(Date.now() + serverOffset.current),
    );
  }
  async function mutate(
    path: string,
    body: any,
    method = 'POST',
    key?: string,
    attachments: any[] = [],
  ) {
    if (!credentials || !outbox)
      throw new Error('请先连接个人后端并等待初始化');
    if (key) {
      const acknowledged = await outbox.acknowledged(key);
      if (acknowledged !== null && acknowledged !== undefined) {
        await refresh();
        return acknowledged;
      }
    }
    const captured = capture();
    const item = await outbox.enqueue({
      idempotency_key: key ?? randomUUID(),
      message_id: body?.message_id ?? null,
      captured_at: body?.captured_at ?? captured.captured_at,
      capture_timezone: body?.capture_timezone ?? captured.capture_timezone,
      capture_local_date:
        body?.capture_local_date ?? captured.capture_local_date,
      workout_session_id:
        path.match(/workout-sessions\/([^/]+)\/sets/)?.[1] ?? null,
      path,
      method,
      body,
      local_attachments: attachments,
    });
    setPendingInputs(await outbox.list());
    const sync = await outbox.flush(api);
    setPendingInputs(sync.pending);
    const result =
      sync.completed.find((r: any) => r.key === item.idempotency_key)?.result ??
      (await outbox.result(item.idempotency_key));
    if (result !== null && result !== undefined) {
      await refresh();
      return result;
    }
    const failure = sync.pending.find(
      (p: any) => p.idempotency_key === item.idempotency_key,
    )?.last_error;
    throw new ApiClientError(
      failure?.code ?? 'QUEUED',
      failure?.code && failure.code !== 'NETWORK_ERROR'
        ? failure.message
        : '输入已保存到待同步，尚未计入余额；联网后会重试',
      failure?.retryable ?? true,
    );
  }
  async function send(text = draft, extra: any = {}) {
    if (!text.trim() || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError('');
    const signature = messageFingerprint(text, extra);
    const { local_attachments = [], ...serverExtra } = extra;
    const request =
      pending?.signature === signature
        ? pending.request
        : {
            message_id: randomUUID(),
            conversation_id: 'main',
            text,
            workout_session_id:
              data.sessions.find((w) => ['active', 'paused'].includes(w.status))
                ?.id ?? null,
            workout_exercise_id:
              data.sessions.find((w) => ['active', 'paused'].includes(w.status))
                ?.current_exercise_id ?? null,
            ...serverExtra,
            ...capture(),
          };
    setPending({ signature, request });
    try {
      if (scope)
        await CacheStore.set('pending-chat.' + scope, { signature, request });
      const result = await mutate(
        '/chat',
        request,
        'POST',
        request.message_id,
        local_attachments,
      );
      if (result.status === 'completed') {
        setDraft('');
        setPending(null);
        if (scope) await CacheStore.remove('pending-chat.' + scope);
      } else setError(result.error?.message ?? '部分操作已保存，请查看回执');
      return result;
    } catch (e: any) {
      setError(e.message);
      throw e;
    } finally {
      setBusy(false);
      sending.current = false;
    }
  }
  async function disconnect() {
    const { clearPlanNotifications } = await import(
      '../native/expo-notifications'
    );
    await clearPlanNotifications();
    await CredentialStore.clear();
    generation.current++;
    setCredentials(null);
    setReminderStatus(null);
    setOutbox(null);
    setScope('');
    setData(empty);
    setPendingInputs([]);
    fresh.current = false;
  }
  async function removePending(key: string) {
    await outbox?.remove(key);
    setPendingInputs((await outbox?.list()) ?? []);
  }
  return (
    <Context.Provider
      value={{
        ...data,
        api,
        credentials,
        ready,
        error,
        setError,
        busy,
        draft,
        setDraft,
        refresh,
        connect,
        disconnect,
        mutate,
        send,
        pendingInputs,
        offline,
        removePending,
        scope,
        reminderStatus,
        setReminderStatus,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useApp() {
  return useContext(Context) as AppData & {
    api: ApiClient;
    credentials: Credentials | null;
    ready: boolean;
    error: string;
    setError: (s: string) => void;
    busy: boolean;
    draft: string;
    setDraft: (s: string) => void;
    refresh: () => Promise<void>;
    connect: (c: Credentials) => Promise<void>;
    disconnect: () => Promise<void>;
    mutate: (
      path: string,
      body: any,
      method?: string,
      key?: string,
      attachments?: any[],
    ) => Promise<any>;
    send: (text?: string, extra?: any) => Promise<any>;
    pendingInputs: PendingInput[];
    offline: boolean;
    removePending: (key: string) => Promise<void>;
    scope: string;
    reminderStatus: any;
    setReminderStatus: (status: any) => void;
  };
}
