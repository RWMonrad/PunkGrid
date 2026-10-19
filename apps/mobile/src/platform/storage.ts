// Device storage binding. The token lives in SecureStore (hardware-backed
// keychain/keystore) and everything else in AsyncStorage: the server address and
// the feature flags are not secrets, but they are per-device, and a mixed store
// keeps the session store platform-free.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type { KvStore } from '../lib/session';

const SECURE = new Set(['punkgrid.token']);

export const deviceStore: KvStore = {
  async get(key) {
    if (SECURE.has(key)) return (await SecureStore.getItemAsync(key)) ?? null;
    return (await AsyncStorage.getItem(key)) ?? null;
  },
  async set(key, value) {
    if (SECURE.has(key)) {
      await SecureStore.setItemAsync(key, value);
      return;
    }
    await AsyncStorage.setItem(key, value);
  },
  async del(key) {
    if (SECURE.has(key)) {
      await SecureStore.deleteItemAsync(key);
      return;
    }
    await AsyncStorage.removeItem(key);
  },
};
