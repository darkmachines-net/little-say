/** @file Persists Firebase native credentials in chunked, atomically committed OS SecureStore records. */
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { getReactNativePersistence } from 'firebase/auth';

let pending: Promise<unknown> = Promise.resolve();
function serialize<T>(action: () => Promise<T>): Promise<T> {
  const next = pending.then(action, action); pending = next.catch(() => {}); return next;
}
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
async function keyFor(key: string) { return 'little-say-firebase-' + await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, key); }
type Manifest = { version: string; count: number };
async function manifest(key: string): Promise<Manifest | null> {
  const raw = await SecureStore.getItemAsync(key);
  if (!raw) return null;
  const value = JSON.parse(raw) as Manifest;
  if (!/^[a-f0-9-]+$/.test(value.version) || !Number.isInteger(value.count) || value.count < 1 || value.count > 256) throw new Error('Saved authentication is invalid. Sign in again.');
  return value;
}
async function removeChunks(key: string, value: Manifest | null) {
  if (value) for (let index = 0; index < value.count; index++) await SecureStore.deleteItemAsync(key + '.' + value.version + '.' + index);
}

/** Firebase's asynchronous storage adapter; secret values never enter the local board database. */
export const secureAuthStorage = {
  /** Read only a fully committed record; a partial OS-store failure requires a fresh sign-in. */
  getItem(key: string): Promise<string | null> { return serialize(async () => {
    const name = await keyFor(key), value = await manifest(name); if (!value) return null;
    const parts: string[] = [];
    for (let index = 0; index < value.count; index++) {
      const part = await SecureStore.getItemAsync(name + '.' + value.version + '.' + index);
      if (part === null) throw new Error('Saved authentication is incomplete. Sign in again.');
      parts.push(part);
    }
    return parts.join('');
  }); },
  /** Commit the manifest after all new chunks, retaining the previous record if a write fails. */
  setItem(key: string, text: string): Promise<void> { return serialize(async () => {
    const name = await keyFor(key), old = await manifest(name), version = Crypto.randomUUID();
    const chunks = text.match(/[\s\S]{1,400}/g) ?? [''];
    if (chunks.length > 256) throw new Error('Authentication record exceeds secure storage capacity.');
    let written = 0;
    try {
      for (const part of chunks) { await SecureStore.setItemAsync(name + '.' + version + '.' + written, part, options); written++; }
      await SecureStore.setItemAsync(name, JSON.stringify({ version, count: chunks.length }), options);
    } catch (error) { await removeChunks(name, { version, count: written }).catch(() => {}); throw error; }
    await removeChunks(name, old).catch(() => {});
  }); },
  /** Remove the commit pointer first so sign-out cannot restore stale chunks after interruption. */
  removeItem(key: string): Promise<void> { return serialize(async () => {
    const name = await keyFor(key), old = await manifest(name);
    await SecureStore.deleteItemAsync(name); await removeChunks(name, old);
  }); },
};
/** Supply the supported Firebase React Native persistence adapter. */
export function authPersistence() { return getReactNativePersistence(secureAuthStorage); }
/** Native Firebase needs secure persistence and never installs a browser popup resolver. */
export function authDependencies() { return { persistence: authPersistence() }; }
