import { themedComponent } from '../../lib/appearance';
Component(themedComponent({
  properties: { items: Array, busy: Boolean },
  methods: {
    retry(e: any) {
      this.triggerEvent('retry', { id: e.currentTarget.dataset.id });
    },
    discard(e: any) {
      this.triggerEvent('discard', { id: e.currentTarget.dataset.id });
    },
  },
}));
