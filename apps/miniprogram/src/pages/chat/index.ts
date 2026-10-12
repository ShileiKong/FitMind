import { client, definePage } from '../../lib/page';
import { chatActions } from '../../lib/chat-actions';
import { chatView } from '../../lib/view';
import {
  followChat,
  hideChat,
  readyChat,
  queuedChatMessages,
  renderChat,
  scrollChat,
  showChat,
  watchChatPending,
} from '../../lib/chat-scroll';
const conversation = definePage({
  data: {
    draft: '',
    messages: [],
    attachments: [],
    recording: false,
    expanded: {},
    active: null,
    capabilities: null,
  },
  render(c: any) {
    const pending = c.pending();
    renderChat(this, c, {
      messages: chatView(queuedChatMessages(c.data.messages, pending), {
        ...c.data,
        pending,
      }),
      pending,
      active: c.data.context?.active_workout || null,
      capabilities: c.data.capabilities,
      draft: c.saved('draft', ''),
      attachments: c.saved('attachments', []),
    });
  },
  ...chatActions,
  async send() {
    if (this.data.busy) return;
    const c = client(),
      scope = c.storageKey;
    followChat(this);
    const sending = chatActions.send.call(this);
    const stopWatching = watchChatPending(this, c, scope);
    try {
      await sending;
    } finally {
      stopWatching();
      if (client() === c && c.storageKey === scope && this._chatVisible)
        this.render(c);
    }
  },
  onReady() {
    readyChat(this);
  },
  onPageScroll() {
    scrollChat(this);
  },
  openConversation() {},
  onHide() {
    hideChat(this);
    this._visible = false;
    clearInterval(this._timer);
    this.cancelRecording();
  },
  onUnload() {
    hideChat(this);
    this._visible = false;
    clearInterval(this._timer);
    this.cancelRecording();
  },
});
Page({
  ...conversation,
  onShow(this: any) {
    showChat(this);
    return conversation.onShow.call(this);
  },
});
