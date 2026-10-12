import { client, definePage, action } from '../../lib/page';
import { exerciseView, optionalNumber } from '../../lib/view';

function actualInput(page: any) {
  const reps = Number(page.data.reps);
  if (
    page.data.reps.trim() === '' ||
    !Number.isInteger(reps) ||
    reps < 0 ||
    reps > 300
  )
    throw new Error('请输入实际完成的次数（0–300）');
  const rpe = optionalNumber(page.data.rpe, 'RPE');
  if (rpe != null && (rpe < 1 || rpe > 10))
    throw new Error('RPE 范围为 1 至 10');
  return {
    weight_kg: optionalNumber(page.data.weight, '实际重量'),
    reps,
    difficulty: page.data.difficulty,
    rpe,
    pain: page.data.pain,
  };
}
function matchesActual(page: any, input: any) {
  try {
    return Object.entries(actualInput(page)).every(([key, value]) =>
      key === 'rpe' ? (input[key] ?? null) === value : input[key] === value,
    );
  } catch {
    return false;
  }
}
const reasons: Record<string, string> = {
  HOLD: '保持当前重量，优先完成目标次数',
  REDUCE_LOAD: '这组吃力且未达到目标，下组减少一个步长',
  INCREASE_LOAD: '已轻松达到目标上限，下组增加一个步长',
  PAIN_PAUSE: '出现疼痛，训练已暂停，请先评估是否继续',
  UNKNOWN_ACTUAL_LOAD: '缺少实际重量，请补充后再给出重量建议',
  UNKNOWN_INCREMENT: '调整步长未知，先保持重量',
  TWO_SUCCESSES: '连续两次可比训练完成目标，可以考虑下次加重',
};
const workoutPage = definePage({
  data: {
    date: '',
    days: [],
    session: null,
    exercises: [],
    selected: '',
    weight: '',
    reps: '',
    rpe: '',
    difficulty: 'normal',
    difficultyIndex: 1,
    difficulties: ['轻松', '适中', '吃力'],
    pain: false,
    sets: [],
    recommendations: [],
    repsHint: '',
    canRecord: false,
    statusLabel: '',
    currentExercise: null,
    edit: null,
    dateCorrection: '',
    restEnd: 0,
    restRemaining: 0,
  },
  onLoad(q: any) {
    this._id = q.id || '';
    this._idScope = client().storageKey;
  },
  beforeRefresh() {
    this.setData({
      date: '',
      days: [],
      session: null,
      exercises: [],
      sets: [],
      recommendations: [],
    });
  },
  async render(c: any) {
    if (this._idScope && this._idScope !== c.storageKey) {
      this._id = '';
      this._sessionId = '';
      this._previous = '';
    }
    this._idScope = c.storageKey;
    const date = c.data.context?.local_date || '';
    const session =
      this._id && c.connected
        ? await c.request(
            'GET',
            '/workout-sessions/' + encodeURIComponent(this._id),
          )
        : this._id
          ? null
          : c.data.context?.active_workout || null;
    const days = c.data.days.filter((d: any) => d.local_date === date);
    const chosen = c.saved('selected-day', '');
    const selectedDay = c.data.days.find((d: any) => d.id === chosen);
    if (selectedDay && !days.some((d: any) => d.id === selectedDay.id))
      days.push(selectedDay);
    const selected = session?.current_exercise_id || '';
    const exercises = (session?.snapshot.exercises || []).map(exerciseView);
    const ex = exercises.find(
      (e: any) => e.exercise_id === (this.data.edit?.exercise_id || selected),
    );
    const recs =
      c.connected && session
        ? (
            await c.request(
              'GET',
              '/recommendations?session_id=' + encodeURIComponent(session.id),
            )
          ).filter(
            (r: any) =>
              ['proposed', 'paused'].includes(r.status) &&
              r.session_id === session.id &&
              (r.type === 'next_workout' || r.exercise_id === selected),
          )
        : [];
    this.setData({
      date,
      days,
      session,
      exercises,
      selected,
      currentExercise: ex || null,
      canRecord: !!session && ['active', 'paused'].includes(session.status),
      statusLabel: session
        ? (
            {
              active: 'IN PROGRESS',
              paused: 'PAUSED',
              completed: 'COMPLETED',
              abandoned: 'ABANDONED',
            } as any
          )[session.status]
        : '',
      sets: (session?.sets || [])
        .filter((s: any) => !s.undone_at)
        .map((s: any) => ({
          ...s,
          name:
            exercises.find((e: any) => e.exercise_id === s.exercise_id)?.name ||
            '训练组',
          difficultyLabel:
            ({ easy: '轻松', normal: '难度 normal', hard: '吃力' } as any)[
              s.difficulty
            ] || '难度未填',
        })),
      recommendations: recs.map((r: any) => ({
        ...r,
        name:
          r.prescription?.name ||
          exercises.find((e: any) => e.exercise_id === r.exercise_id)?.name ||
          '',
        weightLabel: r.weight_kg == null ? '待补充' : r.weight_kg,
        repsLabel: r.reps_min + '–' + r.reps_max + ' 次',
        reason: reasons[r.reason_code] || r.reason_code,
      })),
    });
    if (session) {
      this._id = session.id;
      const restEnd = c.saved('rest.' + session.id, 0);
      this.setData({
        restEnd,
        restRemaining: Math.max(0, Math.ceil((restEnd - Date.now()) / 1000)),
      });
    }
    if (
      ex &&
      !this.data.edit &&
      (this._previous !== selected || this._sessionId !== session.id)
    ) {
      this._previous = selected;
      this._sessionId = session.id;
      this.setData({
        weight: '',
        reps: '',
        rpe: '',
        repsHint: ex.reps_min + '–' + ex.reps_max,
      });
    }
  },
  async start(e: any) {
    await action(
      this,
      async () => {
        const session = await client().mutate('/workout-sessions', {
          workout_day_id: e.currentTarget.dataset.id,
        });
        this._id = session.id;
        return session;
      },
      '训练已开始',
    );
  },
  async select(e: any) {
    if (
      this.data.session &&
      ['active', 'paused'].includes(this.data.session.status)
    )
      await action(this, () =>
        client().mutate(
          '/workout-sessions/' + this.data.session.id + '/transition',
          {
            expected_version: this.data.session.version,
            action: 'switch',
            exercise_id: e.currentTarget.dataset.id,
          },
        ),
      );
  },
  input(e: any) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
  },
  difficulty(e: any) {
    const i = Number(e.currentTarget?.dataset?.index ?? e.detail.value);
    this.setData({
      difficultyIndex: i,
      difficulty: ['easy', 'normal', 'hard'][i],
    });
  },
  pain(e: any) {
    this.setData({ pain: e.detail.value });
  },
  clearActual() {
    this.setData({ weight: '', reps: '', rpe: '', pain: false, edit: null });
  },
  editSet(e: any) {
    const s = this.data.sets.find(
      (set: any) => set.id === e.currentTarget.dataset.id,
    );
    if (!s) return;
    this.setData({
      edit: s,
      currentExercise: this.data.exercises.find(
        (ex: any) => ex.exercise_id === s.exercise_id,
      ),
      weight: s.weight_kg == null ? '' : String(s.weight_kg),
      reps: String(s.reps),
      rpe: s.rpe == null ? '' : String(s.rpe),
      difficulty: s.difficulty || 'normal',
      difficultyIndex: ['easy', 'normal', 'hard'].indexOf(
        s.difficulty || 'normal',
      ),
      pain: !!s.pain,
    });
  },
  cancelEdit() {
    this.clearActual();
    this.setData({
      currentExercise:
        this.data.exercises.find(
          (ex: any) => ex.exercise_id === this.data.selected,
        ) || null,
    });
  },
  beginRest(exercise_id: string) {
    const exercise = this.data.exercises.find(
      (ex: any) => ex.exercise_id === exercise_id,
    );
    if (!exercise || !this.data.session) return;
    const restEnd = Date.now() + exercise.rest_seconds * 1000;
    client().save('rest.' + this.data.session.id, restEnd);
    this.setData({ restEnd, restRemaining: exercise.rest_seconds });
  },
  endRest() {
    if (this.data.session) client().save('rest.' + this.data.session.id, 0);
    this.setData({ restEnd: 0, restRemaining: 0 });
  },
  async recordSet() {
    await action(
      this,
      async () => {
        if (!this.data.session) throw new Error('请先开始训练');
        const actual = actualInput(this);
        if (this.data.edit) {
          const result = await client().mutate(
            '/workout-sets/' + this.data.edit.id,
            { expected_version: this.data.edit.version, patch: actual },
            'PATCH',
          );
          this.clearActual();
          return result;
        }
        const payload = {
          exercise_id: this.data.selected,
          ...actual,
          local_date: this.data.session.local_date,
        };
        const path = '/workout-sessions/' + this.data.session.id + '/sets';
        const pending = client()
          .pending()
          .find((p) => p.path === path && p.method === 'POST');
        const samePending =
          pending &&
          matchesActual(this, pending.body) &&
          pending.body.exercise_id === payload.exercise_id &&
          pending.body.local_date === payload.local_date;
        const result = samePending
          ? await client().retry(pending.id)
          : await client().mutate(path, {
              ...payload,
              occurred_at: (await client().time()).now_utc,
            });
        this.beginRest(payload.exercise_id);
        this.clearActual();
        return result;
      },
      '这一组已记录',
    );
  },
  afterRetry(p: any) {
    if (p?.path === '/workout-sessions/' + this.data.session?.id + '/sets') {
      this.beginRest(p.body.exercise_id);
      if (
        p.body.exercise_id === this.data.selected &&
        matchesActual(this, p.body)
      )
        this.clearActual();
    } else if (
      this.data.edit &&
      p?.path === '/workout-sets/' + this.data.edit.id &&
      matchesActual(this, p.body.patch)
    )
      this.clearActual();
  },
  async transition(e: any) {
    await action(
      this,
      () =>
        client().mutate(
          '/workout-sessions/' + this.data.session.id + '/transition',
          {
            expected_version: this.data.session.version,
            action: e.currentTarget.dataset.action,
            ...(e.currentTarget.dataset.action === 'change_date'
              ? { local_date: this.data.dateCorrection }
              : {}),
          },
        ),
      '训练状态已更新',
    );
  },
  async accept(e: any) {
    const r = this.data.recommendations.find(
      (r: any) => r.id === e.currentTarget.dataset.id,
    );
    if (r?.status === 'proposed')
      await action(
        this,
        async () => {
          if (r.type === 'next_set') {
            if (
              r.exercise_id !== this.data.selected ||
              r.session_id !== this.data.session?.id
            )
              throw new Error('动作已切换，请查看当前动作的建议');
            this.setData({
              weight: r.weight_kg == null ? '' : String(r.weight_kg),
              repsHint: r.reps_min + '–' + r.reps_max,
            });
            return r;
          }
          return client().mutate('/recommendations/' + r.id + '/accept', {
            expected_version: r.version,
          });
        },
        '已采用建议',
      );
  },
  async undo(e: any) {
    const s = this.data.sets.find(
      (s: any) => s.id === e.currentTarget.dataset.id,
    );
    if (s)
      await action(
        this,
        () =>
          client().mutate('/workout-sets/' + s.id + '/undo', {
            expected_version: s.version,
          }),
        '训练组已撤销',
      );
  },
});
const show = workoutPage.onShow,
  hide = workoutPage.onHide,
  unload = workoutPage.onUnload;
Page({
  ...workoutPage,
  async onShow(this: any) {
    await show.call(this);
    if (!this._visible) return;
    clearInterval(this._restTimer);
    this._restTimer = setInterval(
      () =>
        this.setData({
          restRemaining: Math.max(
            0,
            Math.ceil((this.data.restEnd - Date.now()) / 1000),
          ),
        }),
      1000,
    );
  },
  onHide(this: any) {
    clearInterval(this._restTimer);
    hide.call(this);
  },
  onUnload(this: any) {
    clearInterval(this._restTimer);
    unload.call(this);
  },
});
