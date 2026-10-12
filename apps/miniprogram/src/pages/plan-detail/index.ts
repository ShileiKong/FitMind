import { client, definePage, action } from '../../lib/page';
import { proposalActions } from '../../lib/proposal-actions';
import {
  editorMethods,
  editorMatches,
  loadChoices,
  persistEditor,
  planForm,
  planInput,
  restoreEditor,
  schedulePlan,
} from '../plans/editor';
Page(
  definePage({
    data: {
      plan: null,
      expanded: false,
      trainingDate: '',
      editing: false,
      editorForm: null,
      editorVersion: null,
      loadChoices,
    },
    ...editorMethods,
    editorKey() {
      return 'manual-plan.' + this._id;
    },
    onLoad(q: any) {
      this._id = q.id;
      this.setData({ trainingDate: q.day || '' });
    },
    async render(c: any) {
      if (!c.connected) {
        this.setData({ plan: null });
        return;
      }
      if (!this._id) return;
      const p = await c.request(
        'GET',
        '/plans/' + encodeURIComponent(this._id),
      );
      this.setData({ plan: schedulePlan(p, c.data.context?.local_date || '') });
      restoreEditor(this);
    },
    expand() {
      this.setData({
        expanded: !(this.data.expanded || this.data.trainingDate),
        trainingDate: '',
      });
    },
    async confirm() {
      const plan = this.data.plan;
      await proposalActions.confirmProposal.call(this, {
        detail: { type: 'plan', id: plan?.id, version: plan?.version },
      });
    },
    cancel() {
      wx.showModal({
        title: '取消计划',
        content: '取消后，未开始的训练安排和提醒将停止。',
        success: async (r) => {
          if (r.confirm)
            await action(
              this,
              () =>
                client().mutate('/plans/' + this.data.plan.id + '/cancel', {
                  expected_version: this.data.plan.version,
                }),
              '计划已取消',
            );
        },
      });
    },
    adjust() {
      this.setData({
        editing: !this.data.editing,
        editorForm:
          this.data.editorForm ||
          planForm(this.data.plan, client().data.context?.local_date || ''),
        editorVersion: this.data.editorForm
          ? this.data.editorVersion
          : this.data.plan.version,
      });
      persistEditor(this);
    },
    async savePlan() {
      await action(
        this,
        async () => {
          const input = planInput(this.data.editorForm);
          persistEditor(this);
          const result = await client().mutate(
            '/plans/' + this.data.plan.id,
            { expected_version: this.data.editorVersion, patch: input },
            'PATCH',
          );
          this.finishPatch(input, result);
          return result;
        },
        '计划已更新',
      );
    },
    finishPatch(input: any, result: any) {
      if (editorMatches(this, input)) {
        this.setData({ editing: false, editorForm: null, editorVersion: null });
      } else {
        this.setData({
          editorVersion: Math.max(this.data.editorVersion || 0, result.version),
        });
      }
      persistEditor(this);
    },
    afterRetry(p: any, result: any) {
      if (p?.path === '/plans/' + this._id && p.method === 'PATCH')
        this.finishPatch(p.body.patch, result);
      if (p?.path === '/plans/' + this._id + '/confirm')
        wx.switchTab({ url: '/pages/today/index' });
    },
    async reloadEditor() {
      await action(this, async () => {
        const c = client();
        const current = await c.request(
          'GET',
          '/plans/' + encodeURIComponent(this._id),
        );
        for (const pending of c.pending()) {
          if (
            pending.method === 'PATCH' &&
            pending.path === '/plans/' + this._id
          )
            c.discard(pending.id);
        }
        this.setData({
          plan: schedulePlan(current, c.data.context?.local_date || ''),
          editorForm: planForm(current, c.data.context?.local_date || ''),
          editorVersion: current.version,
          editing: true,
        });
        persistEditor(this);
        return current;
      });
    },
    training(e: any) {
      wx.navigateTo({
        url:
          '/pages/day/index?id=' +
          encodeURIComponent(e.currentTarget.dataset.id),
      });
    },
  }),
);
