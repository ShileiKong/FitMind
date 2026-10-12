import { themedComponent } from '../../lib/appearance';
import { chatActions } from '../../lib/chat-actions';
import {
  attachDock,
  detachDock,
  hideDock,
  syncDock,
  dockPreviewData,
  dockPreviewMethods,
} from '../../lib/dock-preview';
Component(themedComponent({
  data: {
    ...dockPreviewData,
    draft: '',
    attachments: [],
    busy: false,
    recording: false,
    connected: false,
    capabilities: null,
    active: null,
    error: '',
  } as any,
  lifetimes: {
    attached(this: any) {
      attachDock(this);
    },
    detached(this: any) {
      if (this.data.recording) this.cancelRecording();
      detachDock(this);
    },
  },
  pageLifetimes: {
    show(this: any) {
      this._dockHidden = false;
      this.sync();
    },
    hide(this: any) {
      if (this.data.recording) this.cancelRecording();
      hideDock(this);
    },
  },
  methods: {
    ...chatActions,
    ...dockPreviewMethods,
    sync(this: any) {
      syncDock(this);
    },
    async load(this: any) {
      const page: any = getCurrentPages().at(-1);
      await page?.load?.();
      this.sync();
    },
    openChat() {
      wx.navigateTo({ url: '/pages/chat/index' });
    },
  },
}));
