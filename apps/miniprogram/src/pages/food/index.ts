import { client, definePage, action } from '../../lib/page';
import { labelRecord } from '../../lib/view';
Page(
  definePage({
    data: {
      form: {
        name: '',
        basis: '100',
        consumed: '',
        unit: 'g',
        calories: '',
        carbs: '',
        protein: '',
        fat: '',
      },
      units: ['克 g', '毫升 ml', '份'],
      unitIndex: 0,
      date: '',
    },
    render(c: any) {
      this.setData({ date: c.data.context?.local_date || '' });
    },
    input(e: any) {
      this.setData({
        ['form.' + e.currentTarget.dataset.field]: e.detail.value,
      });
    },
    unit(e: any) {
      const i = Number(e.detail.value);
      this.setData({ unitIndex: i, 'form.unit': ['g', 'ml', 'serving'][i] });
    },
    afterRetry(p: any) {
      if (p?.body.kind !== 'food') return;
      try {
        const current = labelRecord(this.data.form, p.body.local_date);
        if (JSON.stringify(current) === JSON.stringify(p.body))
          this.setData({ 'form.name': '', 'form.consumed': '' });
      } catch {
        /* An incomplete edited form should stay available for the user. */
      }
    },
    async save() {
      await action(
        this,
        async () => {
          const ctx = await client().time();
          const body = labelRecord(this.data.form, ctx.local_date);
          const result = await client().mutate('/records', body);
          this.afterRetry({ body });
          return result;
        },
        '饮食已记录',
      );
    },
  }),
);
