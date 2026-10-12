import { afterEach, expect, it, vi } from 'vitest';
import { LocalClient } from '../src/local/client';
import { platformStore } from './local-fixtures';

afterEach(() => vi.unstubAllGlobals());
it('opens each budget source for the date shown on Today, even if the device has crossed midnight', async () => {
  let now = new Date('2026-10-11T10:00:00Z');
  const c = new LocalClient(platformStore(), () => now);
  await c.refresh();
  let definition: any;
  const navigateTo = vi.fn();
  vi.stubGlobal('getApp', () => ({ client: c }));
  vi.stubGlobal('wx', { navigateTo });
  vi.stubGlobal('Page', (value: any) => {
    definition = value;
  });
  await import('../src/pages/today/index');
  const p = {
    ...definition,
    data: structuredClone(definition.data),
    setData(values: any) {
      Object.assign(this.data, values);
    },
  };
  p.render(c);
  now = new Date('2026-10-11T16:01:00Z');
  for (const key of [
    'water_ml',
    'calories_kcal',
    'carbs_g',
    'protein_g',
    'fat_g',
  ]) {
    p.nutritionDetails({ currentTarget: { dataset: { key } } });
    expect(navigateTo).toHaveBeenLastCalledWith({
      url: '/pages/nutrient-detail/index?key=' + key + '&date=2026-10-11',
    });
  }
  p.nutritionDetails({ currentTarget: { dataset: { key: 'invalid' } } });
  expect(navigateTo).toHaveBeenCalledTimes(5);
  p.data.date = '';
  p.nutritionDetails({ currentTarget: { dataset: { key: 'protein_g' } } });
  expect(navigateTo).toHaveBeenCalledTimes(5);
});
