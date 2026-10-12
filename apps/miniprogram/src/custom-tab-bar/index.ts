import { themedComponent } from '../lib/appearance';
import { chatActions } from '../lib/chat-actions';
import {
  attachDock,
  detachDock,
  hideDock,
  syncDock,
  dockPreviewData,
  dockPreviewMethods,
} from '../lib/dock-preview';
const tabs = [
  { path: '/pages/today/index', label: '今日', icon: 'layout-dashboard' },
  { path: '/pages/plans/index', label: '计划', icon: 'calendar-days' },
  { path: '/pages/training/index', label: '训练', icon: 'dumbbell' },
  { path: '/pages/profile/index', label: '我的', icon: 'user-round' },
];
Component(themedComponent({
  data: {
    ...dockPreviewData,
    tabs,
    selected: 0,
    draft: '',
    attachments: [],
    busy: false,
    recording: false,
    connected: false,
    capabilities: null,
    active: null,
    error: '',
    pending: [],
  } as any,
  lifetimes: {
    attached(this: any) {
      attachDock(this);
    },
    detached(this: any) {
      this.cancelRecording();
      detachDock(this);
    },
  },
  pageLifetimes: {
    show(this: any) {
      this._dockHidden = false;
      this.sync();
    },
    hide(this: any) {
      this.cancelRecording();
      hideDock(this);
    },
  },
  methods: {
    ...chatActions,
    ...dockPreviewMethods,
    sync(this: any) {
      syncDock(this);
      const pages = getCurrentPages(),
        route = pages.at(-1)?.route;
      this.setData({
        selected: Math.max(
          0,
          tabs.findIndex((t) => t.path === '/' + route),
        ),
      });
    },
    async load(this: any) {
      const pages = getCurrentPages(),
        page: any = pages.at(-1);
      await page?.load?.();
      this.sync();
    },
    select(this: any, e: any) {
      if (this.data.recording) return;
      const tab = tabs[Number(e.currentTarget.dataset.index)];
      if (tab) wx.switchTab({ url: tab.path });
    },
    openChat() {
      wx.navigateTo({ url: '/pages/chat/index' });
    },
  },
}));
