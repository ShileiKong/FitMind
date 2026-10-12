import { action, client, definePage } from '../../lib/page';
import { proposalActions } from '../../lib/proposal-actions';
Page(
  definePage({
    data: {
      api_key: '',
      model: 'deepseek-flash',
      keySaved: false,
      profile: null,
      targets: [],
      timezone: 'Asia/Shanghai',
      reminder_time: '21:00',
      notifications_enabled: true,
      wechat: null,
      textStatus: '未配置',
      visionStatus: '需 DeepSeek Flash 和 Key',
      transcriptionStatus: '手机键盘听写',
    },
    async render(c: any) {
      if (this._formScope !== c.storageKey) {
        this._formScope = c.storageKey;
        this._profileDirty = false;
        this._modelDirty = false;
      }
      if (c.agent && !this._modelDirty)
        this.setData({
          model: c.agent.modelSettings.model,
          keySaved: !!c.agent.modelSettings.api_key,
        });
      const profile = c.data.profile;
      if (!this._profileDirty)
        this.setData({
          profile,
          timezone: profile?.timezone || 'Asia/Shanghai',
          reminder_time: profile?.reminder_time || '21:00',
          notifications_enabled: profile?.notifications_enabled ?? true,
        });
      this.setData({
        wechat: null,
        targets: c.data.targets,
        textStatus: c.data.capabilities?.demo
          ? '演示'
          : c.data.capabilities?.text
            ? '已配置'
            : '本地记录助手',
        visionStatus: c.data.capabilities?.vision
          ? '已配置'
          : '需 DeepSeek Flash 和 Key',
        transcriptionStatus: c.data.capabilities?.transcription
          ? '已配置'
          : c.data.capabilities?.voice_input === 'keyboard'
            ? '手机键盘听写'
            : '未配置',
      });
    },
    input(e: any) {
      const field = e.currentTarget.dataset.field;
      if (['timezone', 'reminder_time'].includes(field))
        this._profileDirty = true;
      if (['model', 'api_key'].includes(field)) this._modelDirty = true;
      this.setData({ [field]: e.detail.value });
    },
    toggleNotifications(e: any) {
      this._profileDirty = true;
      this.setData({ notifications_enabled: e.detail.value });
    },
    afterRetry(command: any, result: any) {
      if (command?.path !== '/profile' || command.method !== 'PATCH') return;
      const current = {
        expected_version: this.data.profile?.version,
        timezone: this.data.timezone,
        reminder_time: this.data.reminder_time,
        notifications_enabled: this.data.notifications_enabled,
      };
      if (JSON.stringify(command.body) === JSON.stringify(current))
        this._profileDirty = false;
      this.setData({ profile: result });
    },
    async saveModel() {
      await action(
        this,
        async () => {
          const c = client();
          if (!('agent' in c)) throw new Error('请更新到手机本地版。');
          c.agent.saveModel({
            api_key: this.data.api_key.trim() || c.agent.modelSettings.api_key,
            model: this.data.model.trim(),
          });
          this._modelDirty = false;
          this.setData({ api_key: '' });
        },
        'AI 设置已保存',
      );
    },
    async testModel() {
      await action(
        this,
        async () => {
          const c = client();
          if (!('agent' in c)) throw new Error('请更新到手机本地版。');
          await c.agent.testModel();
        },
        'AI 连接正常',
      );
    },
    async clearModel() {
      await action(
        this,
        async () => {
          const c = client();
          if (!('agent' in c)) throw new Error('请更新到手机本地版。');
          c.agent.clearModel();
          this._modelDirty = false;
          this.setData({ api_key: '', keySaved: false });
        },
        '已切换本地记录助手',
      );
    },
    async clearData() {
      await this.resetLocal('all');
    },
    async restartSetup() {
      await this.resetLocal('setup');
    },
    async resetLocal(mode: 'all' | 'setup') {
      if (this.data.busy || this.data.loading) return;
      const c = client(),
        scope = c.storageKey;
      this.setData({ busy: true, error: '' });
      try {
        if (!('core' in c)) throw new Error('请更新到手机本地版。');
        const confirmed = await new Promise<boolean>((resolve) =>
          wx.showModal({
            title: mode === 'all' ? '清空本地数据' : '重新开始首次引导',
            content:
              mode === 'all'
                ? '将删除这部手机中的记录、目标、计划、训练、对话、记忆、个人资料和照片缓存，无法撤销。建议先导出备份。AI Key 和已导出的备份文件保留。'
                : '重置教练资料和引导进度，清理照片缓存；保留饮食、饮水、身体记录、目标、计划、训练、对话、提醒设置和 AI Key。已有体重记录仍可带入核对。',
            confirmText: mode === 'all' ? '确认清空' : '重新引导',
            confirmColor: mode === 'all' ? '#D64C4C' : '#009952',
            success: (r) => resolve(r.confirm),
            fail: () => resolve(false),
          }),
        );
        if (!confirmed) return;
        if (client() !== c || c.storageKey !== scope)
          throw new Error('本地数据已更换，请重新确认。');
        if (mode === 'all') await c.clearLocalData();
        else await c.restartOnboarding();
        await this.load();
        wx.showToast({
          title: mode === 'all' ? '本地数据已清空' : '引导已重新开始',
          icon: 'success',
        });
        if (mode === 'all') wx.switchTab({ url: '/pages/today/index' });
        else wx.navigateTo({ url: '/pages/onboarding/index' });
      } catch (error: any) {
        if (client() === c)
          this.setData({ error: error.message || '重置失败，请重试。' });
      } finally {
        if (client() === c) this.setData({ busy: false, pending: c.pending() });
      }
    },
    async exportData() {
      await action(this, async () => {
        const c = client();
        if (!('core' in c)) throw new Error('请更新到手机本地版。');
        const filePath =
          wx.env.USER_DATA_PATH +
          '/FitMind-' +
          c.data.context.local_date +
          '.json';
        wx.getFileSystemManager().writeFileSync(
          filePath,
          c.exportBackup(),
          'utf8',
        );
        if (!wx.shareFileMessage)
          throw new Error('备份已生成。请更新微信后再次导出以保存文件。');
        await new Promise<void>((resolve, reject) =>
          wx.shareFileMessage({
            filePath,
            fileName: filePath.split('/').pop(),
            success: () => resolve(),
            fail: () => reject(new Error('备份未分享，可再次导出。')),
          }),
        );
      });
    },
    async importData() {
      if (this.data.busy) return;
      const result = await new Promise<any>((resolve) =>
        wx.chooseMessageFile({
          count: 1,
          type: 'file',
          extension: ['json'],
          success: resolve,
          fail: () => resolve(null),
        }),
      );
      if (!result) return;
      await action(this, async () => {
        const c = client();
        if (!('core' in c)) throw new Error('请更新到手机本地版。');
        const file = result.tempFiles[0];
        if (file.size > 10 * 1024 * 1024)
          throw new Error('备份文件过大，请选择小于 10 MB 的 JSON 文件。');
        const text = wx
          .getFileSystemManager()
          .readFileSync(file.path, 'utf8') as string;
        const info = c.inspectBackup(text);
        const confirmed = await new Promise<boolean>((resolve) =>
          wx.showModal({
            title: '导入并替换本地数据',
            content:
              '备份共 ' +
              info.entity_count +
              ' 项数据。导入会替换当前记录、计划、训练和对话，并清理照片缓存。请先导出当前备份。AI Key 保留。',
            confirmText: '确认导入',
            success: (r) => resolve(r.confirm),
            fail: () => resolve(false),
          }),
        );
        if (!confirmed) return;
        await c.importBackup(text);
        this._profileDirty = false;
        wx.showToast({ title: '数据已导入', icon: 'success' });
      });
    },
    async saveProfile() {
      await action(this, async () => {
        if (!this.data.profile) throw new Error('请先读取最新设置');
        const saved = await client().mutate(
          '/profile',
          {
            expected_version: this.data.profile.version,
            timezone: this.data.timezone,
            reminder_time: this.data.reminder_time,
            notifications_enabled: this.data.notifications_enabled,
          },
          'PATCH',
        );
        this._profileDirty = false;
        this.setData({ profile: saved });
      });
    },
    async reloadProfile() {
      await action(this, async () => {
        const profile = await client().request('GET', '/profile');
        this._profileDirty = false;
        this.setData({
          profile,
          timezone: profile.timezone,
          reminder_time: profile.reminder_time,
          notifications_enabled: profile.notifications_enabled,
        });
      });
    },
    // Older pending target commands can still be recovered after this screen moved.
    async confirmTarget(e: any) {
      const target = this.data.targets.find(
        (item: any) => item.id === e.currentTarget.dataset.id,
      );
      if (target)
        await proposalActions.confirmProposal.call(this, {
          detail: { type: 'target', id: target.id, version: target.version },
        });
    },
  }),
);
