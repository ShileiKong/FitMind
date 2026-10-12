import { action, client } from './page';
import { chatView } from './view';
import { proposalActions } from './proposal-actions';

export const dockPreviewData = {
  previewOpen: false,
  preview: null,
  composerFocused: false,
  keyboardHeight: 0,
  previewHeight: 210,
  pending: [],
};

interface DockPreview {
  messageId?: string;
  text: string;
  answer: string;
  receipts: any[];
  errors: string[];
  proposals: any[];
  pending: boolean;
  retryable: boolean;
  actionError?: string;
}
function waiting(text: string): DockPreview {
  return {
    text,
    answer: '',
    receipts: [],
    errors: [],
    proposals: [],
    pending: true,
    retryable: false,
  };
}
function recent(messages: any[], state: any): DockPreview | null {
  const message = chatView(messages, state).at(-1);
  return message
    ? {
        messageId: message.message_id,
        text: message.text,
        answer: message.shortAnswer,
        receipts: message.receipts,
        errors: message.errors,
        proposals: message.proposals,
        pending: message.pending,
        retryable: !!message.result?.error?.retryable,
      }
    : null;
}

export function syncDock(dock: any) {
  if (dock._dockDetached) return;
  const c = client();
  if (dock._dockClient !== c || dock._dockScope !== c.storageKey) {
    const previous = dock._dockClient;
    if (previous && dock.data.recording) dock.cancelRecording();
    dock._dockClient = c;
    dock._dockScope = c.storageKey;
    dock._previewSending = false;
    dock._previewRequestText = null;
    dock._previewFailureId = null;
    dock._insidePreviewGesture = false;
    dock.setData({
      ...dockPreviewData,
      busy: false,
      recording: false,
      error: '',
    });
    if (previous) wx.hideKeyboard?.({});
  }
  let preview = dock._previewSending
    ? waiting(dock._previewRequestText || '')
    : recent(c.data.messages || [], { ...c.data, pending: c.pending() });
  const queued = c.pending().find((p) => p.path === '/chat');
  if (
    dock._previewFailureId &&
    dock._previewFailureId !== queued?.body.message_id
  ) {
    dock._previewFailureId = null;
    dock._previewRequestText = null;
    dock.setData({ error: '' });
  }
  if (
    !dock._previewSending &&
    queued &&
    preview?.messageId !== queued.body.message_id
  ) {
    preview = {
      ...waiting(queued.body.text),
      pending: false,
      errors: [
        queued.error || '上一条输入正在处理或等待确认，请稍后查看回执。',
      ],
      retryable: false,
    };
  }
  if (
    !dock._previewSending &&
    dock.data.error &&
    dock._previewRequestText != null
  ) {
    const matching = preview?.messageId === queued?.body.message_id && !!queued;
    preview = {
      ...(matching ? preview! : waiting(dock._previewRequestText)),
      pending: false,
      errors: [...(matching ? preview!.errors : []), dock.data.error],
      retryable: false,
      actionError: dock.data.error,
    };
  }
  dock.setData({
    preview,
    draft: c.saved('draft', ''),
    attachments: c.saved('attachments', []),
    connected: c.connected,
    capabilities: c.data.capabilities,
    active: c.data.context?.active_workout || null,
    pending: c.pending(),
  });
}

export function attachDock(dock: any) {
  dock._dockDetached = false;
  dock._keyboardListener = (event: any) => {
    if (!dock._dockDetached && !dock._dockHidden)
      dock.keyboardChanged({ detail: event });
  };
  wx.onKeyboardHeightChange?.(dock._keyboardListener);
  dock.sync();
}
export function hideDock(dock: any) {
  dock._dockHidden = true;
  dock.collapsePreview();
  dock.setData({ keyboardHeight: 0 });
}
export function detachDock(dock: any) {
  wx.offKeyboardHeightChange?.(dock._keyboardListener);
  dock._dockDetached = true;
}

export const dockPreviewMethods: Record<
  string,
  (this: any, ...args: any[]) => any
> = {
  ...proposalActions,
  focusComposer() {
    this.sync();
    this._scrollGuardUntil = Date.now() + 500;
    this.setData({ previewOpen: true, composerFocused: true });
  },
  collapsePreview(event?: { reason?: string }) {
    if (
      event?.reason === 'page-scroll' &&
      (Date.now() < (this._scrollGuardUntil || 0) ||
        this._insidePreviewGesture ||
        Date.now() < (this._previewScrollingUntil || 0))
    )
      return;
    if (!this.data.previewOpen && !this.data.composerFocused) return;
    this.setData({ previewOpen: false, composerFocused: false });
    wx.hideKeyboard?.({});
  },
  keyboardChanged(event: any) {
    const height = Math.max(0, Number(event.detail?.height) || 0);
    const windowHeight =
      wx.getWindowInfo?.().windowHeight ||
      wx.getSystemInfoSync?.().windowHeight ||
      700;
    // The keyboard can move the page without a user drag. Ignore that transition.
    this._scrollGuardUntil = Date.now() + 350;
    this.setData({
      keyboardHeight: height,
      previewHeight: Math.min(210, Math.max(40, windowHeight - height - 180)),
    });
  },
  previewTouchStart() {
    this._insidePreviewGesture = true;
  },
  previewTouchMove() {
    /* catchtouchmove keeps preview drags inside the scroll-view. */
  },
  previewScroll() {
    this._previewScrollingUntil = Date.now() + 200;
  },
  previewTouchEnd() {
    this._insidePreviewGesture = false;
    this._previewScrollingUntil = Date.now() + 200;
  },
  beginPreview(text: string) {
    this.sync();
    this._previewRequestText = text;
    this._previewFailureId = null;
    this._previewSending = true;
    this.setData({ previewOpen: true, preview: waiting(text), error: '' });
  },
  finishPreview(c: any, scope: string) {
    if (
      this._dockDetached ||
      client() !== c ||
      c.storageKey !== scope ||
      this._dockScope !== scope
    )
      return;
    this._previewSending = false;
    if (this.data.error)
      this._previewFailureId = c
        .pending()
        .find((p: any) => p.path === '/chat')?.body.message_id;
    this.sync();
  },
  async retry() {
    if (this.data.busy) return;
    const c = client(),
      scope = c.storageKey;
    const queued =
      c.pending().find((p) => p.path === '/chat') || c.pending()[0];
    if (!queued) return;
    if (queued.path !== '/chat') {
      await action(this, () => c.retry(queued.id));
      this.sync();
      return;
    }
    this.beginPreview(queued.body.text);
    await action(this, () => c.retry(queued.id));
    this.finishPreview(c, scope);
  },
};
