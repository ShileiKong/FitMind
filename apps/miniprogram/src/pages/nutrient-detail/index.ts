import { client, definePage } from '../../lib/page';
import { syncAppearance } from '../../lib/appearance';
import {
  fetchNutrientBreakdown,
  nutrientSelection,
} from '../../lib/nutrition-breakdown';

const initial = {
  date: '',
  key: '',
  name: '营养',
  kind: 'food',
  unit: '',
  budget: null,
  rows: [],
  unknownCount: 0,
  loaded: false,
  detailLoading: false,
  detailError: '',
  canAdd: false,
};

function invalidate(page: any) {
  page._visible = false;
  page._detailGeneration = (page._detailGeneration || 0) + 1;
  page._loadGeneration = (page._loadGeneration || 0) + 1;
  clearInterval(page._timer);
}

Page(
  definePage({
    data: initial,
    onLoad(options: any) {
      this._detailOptions = { key: options?.key, date: options?.date };
    },
    onHide() {
      invalidate(this);
    },
    onUnload() {
      invalidate(this);
    },
    async load() {
      const c = client(),
        scope = c.storageKey;
      const generation = (this._loadGeneration =
        (this._loadGeneration || 0) + 1);
      this._detailGeneration = (this._detailGeneration || 0) + 1;
      const current = () =>
        client() === c &&
        c.storageKey === scope &&
        this._loadGeneration === generation &&
        this._visible !== false;
      if (!current()) return;
      if (this._scope !== scope || this._detailClient !== c) {
        this._scope = scope;
        this._detailClient = c;
        this.setData(JSON.parse(JSON.stringify(initial)));
      }
      syncAppearance(this);
      this.setData({
        connected: c.connected,
        pending: c.pending(),
        loading: true,
        error: '',
      });
      try {
        if (!c.connected) throw new Error('先到「我的」连接个人服务');
        await c.refresh();
        if (!current()) return;
        await this.render(c);
      } catch (error: any) {
        if (current())
          this.setData({
            error: error.message || '暂时无法连接服务',
            loaded: false,
            rows: [],
            canAdd: false,
          });
      } finally {
        if (current()) this.setData({ loading: false, pending: c.pending() });
      }
    },
    async render(c: any) {
      const scope = c.storageKey;
      const generation = (this._detailGeneration =
        (this._detailGeneration || 0) + 1);
      const current = () =>
        client() === c &&
        c.storageKey === scope &&
        this._detailGeneration === generation &&
        this._visible !== false;
      if (!current()) return;
      try {
        const selection = nutrientSelection(
          {
            ...this._detailOptions,
            ...(this._selectedDate ? { date: this._selectedDate } : {}),
          },
          c.data.context?.local_date || '',
        );
        // Resolve a missing date only once. Refreshing across midnight keeps this natural day.
        this._selectedDate = selection.date;
        this.setData({
          date: selection.date,
          key: selection.key,
          detailLoading: true,
          detailError: '',
        });
        const result = await fetchNutrientBreakdown(
          c,
          selection.date,
          selection.key,
          current,
        );
        if (!result || !current()) return;
        this.setData({
          ...result,
          loaded: true,
          detailError: '',
          canAdd: result.date === c.data.context?.local_date,
        });
      } catch (error: any) {
        if (current())
          this.setData({
            detailError: error.message || '来源暂时无法加载，请重试',
            loaded: false,
            rows: [],
            canAdd: false,
          });
      } finally {
        if (current()) this.setData({ detailLoading: false });
      }
    },
    editRecord(e: any) {
      const row = this.data.rows.find(
        (value: any) => value.id === e.currentTarget.dataset.id,
      );
      if (row) wx.navigateTo({ url: row.editUrl });
    },
    addRecord() {
      if (
        this.data.canAdd &&
        this.data.date === client().data.context?.local_date
      )
        wx.navigateTo({ url: '/pages/editor/index?mode=' + this.data.kind });
    },
  }),
);
