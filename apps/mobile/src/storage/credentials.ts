import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
export interface Credentials {
  base_url: string;
  token: string;
}
export const CredentialStore = {
  async get(): Promise<Credentials | null> {
    const value =
      Platform.OS === 'web'
        ? globalThis.sessionStorage?.getItem('fitmind.connection')
        : await SecureStore.getItemAsync('fitmind.connection');
    try {
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  },
  async set(c: Credentials) {
    const value = JSON.stringify(c);
    if (Platform.OS === 'web')
      globalThis.sessionStorage?.setItem('fitmind.connection', value);
    else await SecureStore.setItemAsync('fitmind.connection', value);
  },
  async clear() {
    if (Platform.OS === 'web')
      globalThis.sessionStorage?.removeItem('fitmind.connection');
    else await SecureStore.deleteItemAsync('fitmind.connection');
  },
};
