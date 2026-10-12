import { themedComponent } from '../../lib/appearance';
Component(themedComponent({
  properties: {
    value: String,
    hasAttachments: Boolean,
    busy: Boolean,
    placeholder: { type: String, value: '告诉 AI 你刚刚做了什么…' },
    recording: Boolean,
    connected: Boolean,
    capabilities: Object,
    focus: Boolean,
    adjustPosition: { type: Boolean, value: true },
  },
  data: { canSend: false },
  observers: {
    'value, hasAttachments, busy, recording, connected'(
      value: string,
      hasAttachments: boolean,
      busy: boolean,
      recording: boolean,
      connected: boolean,
    ) {
      this.setData({
        canSend:
          connected &&
          !busy &&
          !recording &&
          (!!value.trim() || hasAttachments),
      });
    },
  },
  methods: {
    focus() {
      this.triggerEvent('focus');
    },
    keyboard(e: any) {
      this.triggerEvent('keyboard', { height: e.detail.height });
    },
    input(e: any) {
      this.triggerEvent('input', { value: e.detail.value });
    },
    send() {
      if (!this.data.canSend) return;
      this.triggerEvent('send');
    },
    photo() {
      this.triggerEvent('photo');
    },
    voice() {
      this.triggerEvent('voice');
    },
    conversation() {
      this.triggerEvent('conversation');
    },
  },
}));
