import { client, definePage } from '../../lib/page';
import { proposalActions } from '../../lib/proposal-actions';
import {
  bodyFields,
  editorTitles,
  formFor,
  nutritionFields,
  saveCommand,
} from './form';

const initial = {
  mode: 'water',
  id: '',
  title: '饮水记录',
  form: formFor(null, ''),
  entity: null,
  draft: null,
  history: false,
  nutritionFields,
  bodyFields,
  bodyLabel: '体重 kg',
  units: [
    { key: 'g', label: 'g' },
    { key: 'ml', label: 'ml' },
    { key: 'serving', label: '份' },
  ],
};
Page(
  definePage({
    data: initial,
    onLoad(options: any) {
      this._mode = editorTitles[options.mode] ? options.mode : 'water';
      this._id = options.id || '';
      this.setData({
        mode: this._mode,
        id: this._id,
        title: editorTitles[this._mode],
      });
    },
    draftKey() {
      return 'editor.' + this.data.mode + '.' + (this.data.id || 'new');
    },
    persist() {
      client().save(this.draftKey(), {
        form: this.data.form,
        entity: this.data.entity,
        draft: this.data.draft,
        history: this.data.history,
      });
    },
    updateBodyLabel() {
      this.setData({
        bodyLabel:
          bodyFields.find((field) => field.key === this.data.form.metric)
            ?.label || '体重 kg',
      });
    },
    async load() {
      const c = client();
      if (this._scope !== c.storageKey) {
        this._scope = c.storageKey;
        this._initialized = false;
        this._dirty = false;
        this.setData({
          ...JSON.parse(JSON.stringify(initial)),
          mode: this._mode || 'water',
          id: this._id || '',
          title: editorTitles[this._mode || 'water'],
          error: '',
        });
        const saved = c.saved<any>(this.draftKey(), null);
        if (saved) {
          this.setData(saved);
          this._dirty = true;
          this._initialized = true;
        }
      }
      this.setData({ connected: c.connected, pending: c.pending() });
      if (!c.connected) {
        this.setData({ loading: false, error: '先到「我的」连接个人服务' });
        return;
      }
      if (this._loading) return;
      this._loading = true;
      this.setData({ loading: true });
      try {
        await c.refresh();
        if (this._scope !== c.storageKey) return;
        if (this.data.id && (!this._dirty || !this.data.entity)) {
          const mode = this.data.mode;
          const entity =
            mode === 'target' || mode === 'memory'
              ? (
                  await c.request(
                    'GET',
                    mode === 'target' ? '/targets' : '/memories',
                  )
                ).find((item: any) => item.id === this.data.id)
              : await c.request('GET', '/records/' + this.data.id);
          if (!entity) throw new Error('未找到原记录，请刷新后重试');
          this.setData({
            entity,
            ...(mode === 'target' && entity.status === 'draft'
              ? { draft: entity }
              : {}),
          });
          if (!this._dirty)
            this.setData({
              form: formFor(entity, c.data.context?.local_date || ''),
            });
          this._initialized = true;
        } else if (!this._initialized) {
          this.setData({
            form: formFor(null, c.data.context?.local_date || ''),
          });
          this._initialized = true;
        }
        this.updateBodyLabel();
        this.setData({ error: '' });
      } catch (error: any) {
        this.setData({ error: error.message || '暂时无法连接服务' });
      } finally {
        this._loading = false;
        this.setData({ loading: false, pending: c.pending() });
      }
    },
    input(e: any) {
      const field = e.currentTarget.dataset.field;
      this._dirty = true;
      this.setData({ ['form.' + field]: e.detail.value });
      this.updateBodyLabel();
      this.persist();
    },
    choose(e: any) {
      this.input({
        currentTarget: e.currentTarget,
        detail: { value: e.currentTarget.dataset.value },
      });
    },
    toggleHistory() {
      this.setData({ history: !this.data.history });
      this.persist();
    },
    async reloadEntity() {
      if (this.data.busy) return;
      const path =
        (this.data.mode === 'memory'
          ? '/memories/'
          : this.data.mode === 'target'
            ? '/targets/'
            : '/records/') + this.data.id;
      if (
        client()
          .pending()
          .some(
            (item) => item.path === path || item.path.startsWith(path + '/'),
          )
      ) {
        this.setData({
          error: '请先重试或移除这条记录的待处理输入，再重新加载。',
        });
        return;
      }
      const confirmed = await new Promise<boolean>((resolve) =>
        wx.showModal({
          title: '重新加载原记录',
          content: '将清除当前未保存的修改，读取最新记录。',
          success: (result) => resolve(result.confirm),
          fail: () => resolve(false),
        }),
      );
      if (!confirmed) return;
      this._dirty = false;
      this._initialized = false;
      this.setData({ entity: null, draft: null });
      client().save(this.draftKey(), null);
      await this.load();
    },
    currentCommand() {
      return saveCommand(
        this.data.mode,
        this.data.id,
        this.data.entity,
        this.data.form,
        this.data.history,
      );
    },
    async finish(command: any, result: any) {
      let matches = false;
      if (command.path.endsWith('/confirm'))
        matches =
          !!this.data.draft &&
          command.path === '/targets/' + this.data.draft.id + '/confirm' &&
          command.body.expected_version === this.data.draft.version;
      else if (command.path.endsWith('/undo'))
        matches =
          !!this.data.entity &&
          command.path === '/records/' + this.data.entity.id + '/undo';
      else {
        try {
          const current = this.currentCommand();
          matches =
            current.path === command.path &&
            current.method === command.method &&
            JSON.stringify(current.body) === JSON.stringify(command.body);
        } catch {
          /* Keep an incomplete changed form available. */
        }
      }
      if (command.path === '/targets/drafts') {
        if (matches) {
          this.setData({ draft: result });
          this.persist();
        }
        return;
      }
      if (!matches) {
        if (
          this.data.entity &&
          command.path === '/records/' + this.data.entity.id &&
          result?.entity
        )
          this.setData({ entity: result.entity });
        if (
          this.data.entity &&
          command.path === '/memories/' + this.data.entity.id &&
          result?.id
        )
          this.setData({ entity: result });
        this.persist();
        return;
      }
      client().save(this.draftKey(), null);
      try {
        await client().refresh();
      } catch {
        /* The mutation receipt already confirms success; the parent screen can retry its refresh. */
      }
      if (command.path.endsWith('/confirm'))
        wx.switchTab({ url: '/pages/today/index' });
      else wx.navigateBack();
    },
    async submit(command: any) {
      const result = await client().mutate(
        command.path,
        command.body,
        command.method,
      );
      await this.finish(command, result);
    },
    async run(work: () => Promise<void>) {
      if (this.data.busy) return;
      this.setData({ busy: true, error: '' });
      try {
        await work();
      } catch (error: any) {
        this.setData({ error: error.message || '操作失败，请重试' });
      } finally {
        this.setData({ busy: false, pending: client().pending() });
      }
    },
    async save() {
      await this.run(() => this.submit(this.currentCommand()));
    },
    async confirmTarget() {
      const draft = this.data.draft;
      const result = await proposalActions.confirmProposal.call(this, {
        detail: { type: 'target', id: draft?.id, version: draft?.version },
      });
      if (result) client().save(this.draftKey(), null);
    },
    async undo() {
      await this.run(async () => {
        if (!this.data.entity) throw new Error('原记录尚未加载');
        await this.submit({
          path: '/records/' + this.data.entity.id + '/undo',
          method: 'POST',
          body: { expected_version: this.data.entity.version },
        });
      });
    },
    async retryInput(e: any) {
      await this.run(async () => {
        const id = e.detail?.id || e.currentTarget.dataset.id;
        const command = client()
          .pending()
          .find((item) => item.id === id);
        const result = await client().retry(id);
        if (command) await this.finish(command, result);
      });
    },
  }),
);
