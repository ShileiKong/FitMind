export function platformStore() {
  const values = new Map<string, any>();
  let fail = false;
  return {
    values,
    failWrites(value: boolean) {
      fail = value;
    },
    getStorageSync: (key: string) => structuredClone(values.get(key)),
    setStorageSync(key: string, value: any) {
      if (fail) throw new Error('storage quota exceeded');
      values.set(key, structuredClone(value));
    },
    removeStorageSync(key: string) {
      values.delete(key);
    },
    getStorageInfoSync() {
      return { keys: [...values.keys()] };
    },
  };
}
