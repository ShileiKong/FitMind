export type Skin = 'midnight' | 'deepseek';
const preferenceKey = 'fitmind.appearance.v1';
const midnight = {
  base: '#000000',
  text: '#F5F7F6',
  muted: '#93A69B',
  accent: '#00ED85',
  'on-accent': '#001A0D',
  surface: '#080E0B',
  input: '#0C1711',
  dock: '#020805',
  composer: '#030C07',
  preview: '#08140D',
  'goal-surface': '#05110B',
  'budget-surface': '#04120B',
  'button-surface': '#07130C',
  line: '#173426',
  soft: '#072B19',
  danger: '#FFA39B',
  pending: '#554B1B',
  warning: '#E8D6A0',
  glow: '#00D97629',
  'glow-fade': '#0066380a',
  'budget-glow': '#00D66C1f',
};
const deepseek: typeof midnight = {
  base: '#F3F6FF',
  text: '#25345A',
  muted: '#667498',
  accent: '#526FD6',
  'on-accent': '#FFFFFF',
  surface: '#FFFFFF',
  input: '#EAF0FF',
  dock: '#F9FAFF',
  composer: '#FFFFFF',
  preview: '#F1F4FF',
  'goal-surface': '#F5F7FF',
  'budget-surface': '#FFFFFF',
  'button-surface': '#FFFFFF',
  line: '#DDE4F4',
  soft: '#E3E9FE',
  danger: '#B94356',
  pending: '#D1B96A',
  warning: '#796023',
  glow: '#C8CEFB80',
  'glow-fade': '#E0E8FF40',
  'budget-glow': '#DBE6FF55',
};
export function skinData(skin: Skin = 'midnight') {
  const palette = skin === 'deepseek' ? deepseek : midnight;
  const tokens: Record<string, string> = { ...palette };
  for (const alpha of [
    '05',
    '10',
    '12',
    '14',
    '1A',
    '1C',
    '20',
    '24',
    '26',
    '28',
    '2A',
    '2E',
    '30',
    '44',
  ])
    tokens['accent-' + alpha.toLowerCase()] = palette.accent + alpha;
  return {
    skin,
    skinName: skin === 'deepseek' ? 'DeepSeek · 蓝鲸' : '科技黑绿',
    skinStyle: Object.entries(tokens)
      .map(([k, v]) => '--fm-' + k + ':' + v + ';')
      .join(''),
    skinAccent: palette.accent,
    skinAccentIcon: skin === 'deepseek' ? 'blue' : 'green',
    skinMutedIcon: skin === 'deepseek' ? 'slate' : 'muted',
    skinTextIcon: skin === 'deepseek' ? 'ink' : 'text',
    skinSendIcon: skin === 'deepseek' ? 'white' : 'dark',
    skinBase: palette.base,
  };
}
export class Appearance {
  private skin: Skin = 'midnight';
  private listeners = new Set<() => void>();
  constructor(private platform: any) {
    try {
      if (platform.getStorageSync(preferenceKey) === 'deepseek')
        this.skin = 'deepseek';
    } catch {
      /* A missing preference still permits the default appearance. */
    }
  }
  get data() {
    return skinData(this.skin);
  }
  select(value: string) {
    if (!['midnight', 'deepseek'].includes(value))
      throw new Error('请选择可用的皮肤。');
    if (value === this.skin) return;
    try {
      this.platform.setStorageSync(preferenceKey, value);
    } catch {
      throw new Error('皮肤选择未能保存，请释放手机存储后重试。');
    }
    this.skin = value as Skin;
    for (const listener of this.listeners) listener();
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
const appearance = (): Appearance | undefined =>
  typeof getApp === 'function' ? (getApp() as any)?.appearance : undefined;
export function syncAppearance(view: any, navigation = false) {
  const data = appearance()?.data || skinData();
  view.setData(data);
  if (!navigation || typeof wx === 'undefined') return;
  wx.setNavigationBarColor?.({
    frontColor: data.skin === 'deepseek' ? '#000000' : '#ffffff',
    backgroundColor: data.skinBase,
  });
  wx.setBackgroundColor?.({
    backgroundColor: data.skinBase,
    backgroundColorTop: data.skinBase,
    backgroundColorBottom: data.skinBase,
  });
}
function attach(view: any, isPage: boolean) {
  view._appearanceOff?.();
  syncAppearance(view);
  view._appearanceOff = appearance()?.subscribe(() =>
    syncAppearance(view, isPage && !!view._visible),
  );
}
export function themedPage(definition: any) {
  return {
    ...definition,
    data: { ...definition.data, ...skinData() },
    onLoad(this: any, ...args: any[]) {
      attach(this, true);
      return definition.onLoad?.apply(this, args);
    },
    onShow(this: any, ...args: any[]) {
      syncAppearance(this, true);
      return definition.onShow?.apply(this, args);
    },
    onUnload(this: any, ...args: any[]) {
      this._appearanceOff?.();
      return definition.onUnload?.apply(this, args);
    },
  };
}
export function themedComponent<
  D extends WechatMiniprogram.Component.DataOption,
  P extends WechatMiniprogram.Component.PropertyOption,
  M extends WechatMiniprogram.Component.MethodOption,
>(definition: WechatMiniprogram.Component.Options<D, P, M, []>) {
  const life = definition.lifetimes || {};
  return {
    ...definition,
    data: { ...definition.data, ...skinData() },
    lifetimes: {
      ...life,
      attached(this: any) {
        attach(this, false);
        return life.attached?.call(this);
      },
      detached(this: any) {
        this._appearanceOff?.();
        return life.detached?.call(this);
      },
    },
  };
}
