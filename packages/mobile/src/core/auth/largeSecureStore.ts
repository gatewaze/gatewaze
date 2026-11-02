/**
 * Session storage adapter for supabase-js.
 *
 * expo-secure-store caps values at 2048 bytes and Supabase sessions exceed
 * that, so this follows the Supabase-documented pattern: a random 256-bit
 * key held in the secure store encrypts the session blob, which lives in
 * AsyncStorage.
 *
 * DEVIATION FROM SPEC (recorded): spec-mobile-app.md names AES-256-GCM.
 * aes-js (the pure-JS cipher available without native crypto) provides CTR
 * but not GCM, so v1 ships AES-256-CTR — confidentiality but not
 * authenticated encryption. Upgrading to GCM needs a native crypto module
 * (e.g. react-native-quick-crypto) entering the core dependency surface;
 * tracked as a follow-up before the phase-2 public listing.
 */

import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import aesjs from 'aes-js';

function keyName(storageKey: string): string {
  // SecureStore keys allow [A-Za-z0-9._-] only.
  return storageKey.replace(/[^A-Za-z0-9._-]/g, '_');
}

async function getOrCreateKey(storageKey: string): Promise<Uint8Array> {
  const name = keyName(storageKey);
  const existing = await SecureStore.getItemAsync(name);
  if (existing) return aesjs.utils.hex.toBytes(existing);
  const fresh = Crypto.getRandomBytes(32);
  await SecureStore.setItemAsync(name, aesjs.utils.hex.fromBytes(fresh));
  return fresh;
}

async function encrypt(storageKey: string, value: string): Promise<string> {
  const key = await getOrCreateKey(storageKey);
  const counter = Crypto.getRandomBytes(16);
  const cipher = new aesjs.ModeOfOperation.ctr(key, new aesjs.Counter(counter));
  const encrypted = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
  return aesjs.utils.hex.fromBytes(counter) + ':' + aesjs.utils.hex.fromBytes(encrypted);
}

async function decrypt(storageKey: string, stored: string): Promise<string | null> {
  const name = keyName(storageKey);
  const hexKey = await SecureStore.getItemAsync(name);
  if (!hexKey) return null;
  const [counterHex, dataHex] = stored.split(':');
  if (!counterHex || !dataHex) return null;
  try {
    const cipher = new aesjs.ModeOfOperation.ctr(
      aesjs.utils.hex.toBytes(hexKey),
      new aesjs.Counter(aesjs.utils.hex.toBytes(counterHex))
    );
    return aesjs.utils.utf8.fromBytes(cipher.decrypt(aesjs.utils.hex.toBytes(dataHex)));
  } catch {
    return null;
  }
}

export const largeSecureStore = {
  async getItem(key: string): Promise<string | null> {
    const stored = await AsyncStorage.getItem(key);
    if (!stored) return null;
    return decrypt(key, stored);
  },
  async setItem(key: string, value: string): Promise<void> {
    await AsyncStorage.setItem(key, await encrypt(key, value));
  },
  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(keyName(key)).catch(() => {});
  },
};
