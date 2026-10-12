import { themedComponent } from '../../lib/appearance';
Component(themedComponent({
  properties: { percent: Number },
  data: { firstAngle: 0, secondAngle: 0 },
  observers: {
    percent(value: number) {
      const progress = Number.isFinite(value)
        ? Math.min(100, Math.max(0, value))
        : 0;
      this.setData({
        firstAngle: Math.min(180, progress * 3.6),
        secondAngle: Math.max(0, progress * 3.6 - 180),
      });
    },
  },
}));
