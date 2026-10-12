import { client, definePage } from '../../lib/page';
import { chatView } from '../../lib/view';
import { proposalActions } from '../../lib/proposal-actions';
import {
  nextSetupQuestion,
  parseSetupAnswer,
  setupDraftPrompt,
  setupQuestions,
  setupSummary,
  type SetupStep,
} from '../../lib/onboarding';

Page(
  definePage({
    data: {
      answer: '',
      question: setupQuestions.body,
      rows: [],
      completed: false,
      hasAI: false,
      suggestion: null,
      ready: false,
      knownBodyLabel: '',
    },
    async render(c: any) {
      if (this._setupScope !== c.storageKey) {
        this._setupScope = c.storageKey;
        const saved = c.saved('setup.input', null);
        this._stepOverride = saved?.step;
        this._answerContext = saved?.known || null;
        this._suggestionId = saved?.suggestionId || '';
        this.setData({ answer: saved?.answer || '', suggestion: null });
      }
      const profile = c.data.profile || {};
      const scope = c.storageKey;
      const points = !profile.fitness?.weight_kg
        ? (await c.request('GET', '/trends?metric=weight_kg')).points
        : [];
      if (scope !== c.storageKey) return;
      const latestWeight = points.at(-1);
      this._seedFitness =
        latestWeight?.value >= 10 && latestWeight.value <= 400
          ? { weight_kg: latestWeight.value }
          : {};
      this._knownFitness = { ...this._seedFitness, ...profile.fitness };
      const boundary = c.core?.store.onboardingAfterMessageId;
      const storedMessages =
        c.core?.store.list('personal', 'message').reverse() || [];
      const boundaryIndex = storedMessages.findIndex(
        (m: any) => m.id === boundary,
      );
      const eligibleIds = new Set(
        (boundary && boundaryIndex < 0
          ? []
          : storedMessages.slice(boundary ? boundaryIndex + 1 : 0)
        ).map((m: any) => m.id),
      );
      const eligibleMessages =
        boundary === undefined
          ? c.data.messages
          : c.data.messages.filter((m: any) => eligibleIds.has(m.message_id));
      if (!this._suggestionId)
        this._suggestionId =
          eligibleMessages
            .filter((m: any) => m.text === setupDraftPrompt())
            .at(-1)?.message_id || '';
      const question =
        (this._stepOverride &&
          setupQuestions[this._stepOverride as SetupStep]) ||
        nextSetupQuestion({ ...profile, fitness: this._knownFitness });
      const saved = c.data.messages.find(
        (m: any) => m.message_id === this._suggestionId,
      );
      this.setData({
        question,
        rows: setupSummary(this._knownFitness),
        knownBodyLabel: this._seedFitness.weight_kg
          ? `沿用 ${latestWeight.local_date} 已记录的体重 ${latestWeight.value} kg；需要更正可以直接告诉我。`
          : '',
        completed: profile.onboarding_status === 'completed',
        hasAI: !!c.data.capabilities?.text,
        suggestion: saved
          ? chatView([saved], { ...c.data, pending: c.pending() })[0]
          : null,
        ready:
          !!this._knownFitness.height_cm &&
          !!this._knownFitness.weight_kg &&
          !!this._knownFitness.goal &&
          !!this._knownFitness.strength_training,
      });
    },
    persist() {
      client().save('setup.input', {
        answer: this.data.answer,
        step:
          this._stepOverride || (this.data.answer ? this.data.question.id : ''),
        known: this._answerContext || null,
        suggestionId: this._suggestionId || '',
      });
    },
    input(e: any) {
      if (!this._answerContext) this._answerContext = this._knownFitness;
      this._stepOverride = this.data.question.id;
      this.setData({ answer: e.detail.value });
      try {
        this.persist();
      } catch (error: any) {
        this.setData({ error: error.message || '答案暂未保存，请稍后重试。' });
      }
    },
    async choose(e: any) {
      this.input({ detail: { value: e.currentTarget.dataset.value } });
      await this.submit();
    },
    edit(e: any) {
      if (this.data.busy) return;
      const step = e.currentTarget.dataset.step as SetupStep;
      if (!setupQuestions[step] || step === 'review') return;
      this._stepOverride = step;
      this._answerContext = this._knownFitness;
      this.setData({ answer: '', question: setupQuestions[step] });
      try {
        this.persist();
      } catch (error: any) {
        this.setData({ error: error.message });
      }
    },
    async run(work: () => Promise<void>) {
      if (this.data.busy) return;
      const scope = client().storageKey;
      this.setData({ busy: true, error: '' });
      try {
        await work();
      } catch (error: any) {
        if (scope === client().storageKey)
          this.setData({ error: error.message || '操作失败，请重试。' });
      } finally {
        if (scope === client().storageKey)
          this.setData({ busy: false, pending: client().pending() });
      }
    },
    async submit() {
      await this.run(async () => {
        const step = this.data.question.id as SetupStep,
          answer = this.data.answer;
        const fitness = {
          ...this._seedFitness,
          ...parseSetupAnswer(
            step,
            answer,
            this._answerContext || this._knownFitness,
          ),
        };
        await client().mutate(
          '/profile',
          {
            expected_version: client().data.profile.version,
            fitness,
            onboarding_status: 'in_progress',
          },
          'PATCH',
        );
        if (this.data.answer === answer && this.data.question.id === step) {
          this._stepOverride = '';
          this._answerContext = null;
          this.setData({ answer: '' });
          this.persist();
        }
        await this.load();
      });
    },
    async skipSetup() {
      await this.run(async () => {
        await client().mutate(
          '/profile',
          {
            expected_version: client().data.profile.version,
            onboarding_status: 'skipped',
          },
          'PATCH',
        );
        await client().refresh();
        wx.switchTab({ url: '/pages/today/index' });
      });
    },
    async finish() {
      await this.run(async () => {
        if (!this.data.ready)
          throw new Error('先填写身高、体重、目标和力量训练选择。');
        if (!this.data.completed)
          await client().mutate(
            '/profile',
            {
              expected_version: client().data.profile.version,
              ...(Object.keys(this._seedFitness || {}).length
                ? { fitness: this._seedFitness }
                : {}),
              onboarding_status: 'completed',
            },
            'PATCH',
          );
        this._stepOverride = '';
        this._answerContext = null;
        this.setData({ answer: '' });
        this.persist();
        await this.load();
        wx.showToast({ title: '资料已保存', icon: 'success' });
      });
    },
    async suggest() {
      // Completion and model calls are separate: a model failure cannot undo saved facts.
      if (!this.data.completed) await this.finish();
      if (!this.data.completed || this.data.error || this.data.busy) return;
      await this.run(async () => {
        if (!this.data.hasAI)
          throw new Error('资料已经保存，先到设置接入 AI，再生成建议。');
        if (this._suggestionId)
          throw new Error(
            '已有建议，请先查看或恢复这条回复。需要新方案可进入完整对话。',
          );
        const result = await client().sendChat(setupDraftPrompt(), {
          attachment_ids: [],
          workout_session_id: null,
          workout_exercise_id: null,
        });
        this._suggestionId = result.message_id;
        this.persist();
        await this.load();
      });
    },
    async recoverSuggestion() {
      await this.run(async () => {
        if (!this._suggestionId) return;
        await client().mutate(
          '/messages/' + encodeURIComponent(this._suggestionId) + '/recover',
          {},
        );
        await this.load();
      });
    },
    async retryInput(e: any) {
      await this.run(async () => {
        const c = client(),
          id = e.detail?.id || e.currentTarget.dataset.id;
        const command = c.pending().find((p: any) => p.id === id);
        const result = await c.retry(id);
        if (command?.path === '/chat') {
          this._suggestionId = result.message_id;
          this.persist();
        }
        if (command?.path === '/profile' && command.body.fitness) {
          let same = false;
          try {
            const parsed = parseSetupAnswer(
              this.data.question.id,
              this.data.answer,
              this._answerContext || this._knownFitness,
            );
            same =
              Object.entries(parsed).length > 0 &&
              Object.entries(parsed).every(
                ([key, value]) => command.body.fitness[key] === value,
              );
          } catch {
            /* Keep a changed or incomplete answer. */
          }
          if (same) {
            this._stepOverride = '';
            this._answerContext = null;
            this.setData({ answer: '' });
            this.persist();
          }
        }
        await this.load();
      });
    },
    ...proposalActions,
    home() {
      wx.switchTab({ url: '/pages/today/index' });
    },
  }),
);
