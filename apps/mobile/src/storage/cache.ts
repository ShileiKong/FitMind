import AsyncStorage from '@react-native-async-storage/async-storage';
export const CacheStore = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const v = await AsyncStorage.getItem('fitmind.' + key);
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  },
  async set(key: string, value: unknown) {
    await AsyncStorage.setItem('fitmind.' + key, JSON.stringify(value));
  },
  async remove(key: string) {
    await AsyncStorage.removeItem('fitmind.' + key);
  },
};
