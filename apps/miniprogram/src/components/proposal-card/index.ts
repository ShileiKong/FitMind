import { themedComponent } from '../../lib/appearance';
Component(themedComponent({
  properties: { proposal: { type: Object, value: null }, busy: { type: Boolean, value: false } },
  methods: {
    view(this: any) { this.triggerEvent('view', this.data.proposal); },
    confirm(this: any) {
      if (!this.data.busy && this.data.proposal?.canConfirm)
        this.triggerEvent('confirm', this.data.proposal);
    },
  },
}));
