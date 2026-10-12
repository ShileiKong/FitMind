import { definePage, client, action } from '../../lib/page';
import {
  editorMethods,
  editorMatches,
  loadChoices,
  persistEditor,
  planForm,
  planInput,
  restoreEditor,
  schedulePlan,
} from './editor';
Page(
  definePage({
    data: { plans: [], editing: false, editorForm: null, loadChoices },
    ...editorMethods,
    editorKey() {
      return 'manual-plan';
    },
    render(c: any) {
      this.setData({ plans: c.data.plans.map((p: any) => schedulePlan(p)) });
      if (c.connected) restoreEditor(this);
    },
    detail(e: any) {
      wx.navigateTo({
        url:
          '/pages/plan-detail/index?id=' +
          encodeURIComponent(e.currentTarget.dataset.id),
      });
    },
    newPlan() {
      if (!client().connected) return;
      this.setData({
        editing: !this.data.editing,
        editorForm:
          this.data.editorForm ||
          planForm(null, client().data.context?.local_date || ''),
      });
      persistEditor(this);
    },
    finishDraft(input: any, result: any) {
      if (!editorMatches(this, input)) return;
      this.setData({ editing: false, editorForm: null });
      persistEditor(this);
      wx.navigateTo({
        url: '/pages/plan-detail/index?id=' + encodeURIComponent(result.id),
      });
    },
    async savePlan() {
      await action(this, async () => {
        const input = planInput(this.data.editorForm);
        persistEditor(this);
        const result = await client().mutate('/plans/drafts', input);
        this.finishDraft(input, result);
        return result;
      });
    },
    afterRetry(p: any, result: any) {
      if (p?.path === '/plans/drafts') this.finishDraft(p.body, result);
    },
  }),
);
