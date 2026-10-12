import { client, definePage, action } from '../../lib/page';
import { chatActions } from '../../lib/chat-actions';
import { chatView } from '../../lib/view';
Page(
  definePage({
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
      this.setData({
        messages: chatView(c.data.messages, { ...c.data, pending: c.pending() }),
        active: c.data.context?.active_workout || null,
        capabilities: c.data.capabilities,
        draft: c.saved('draft', ''),
        attachments: c.saved('attachments', []),
      });
    },
    ...chatActions,
    openConversation() {},
    onHide() {
      this._visible = false;
      clearInterval(this._timer);
      this.cancelRecording();
    },
    onUnload() {
      this._visible = false;
      clearInterval(this._timer);
      this.cancelRecording();
    },
  }),
);
