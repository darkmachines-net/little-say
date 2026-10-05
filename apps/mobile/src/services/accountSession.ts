/** @file Keeps native account sessions in the OS secure credential store, separate from library backups. */

import * as SecureStore from 'expo-secure-store';
import { type Account } from '@little-say/core';
export type AccountSession = { account: Account; server: string; token?: string };
const key = 'little-say-account';
/** Restore credentials for exactly the server where the parent signed in. */
export async function loadAccountSession(): Promise<AccountSession | null> {
  const value = await SecureStore.getItemAsync(key); return value ? JSON.parse(value) : null;
}
/** Save a native session securely, or disconnect this installation without removing its local boards. */
export async function saveAccountSession(value: AccountSession | null): Promise<void> {
  if (value) await SecureStore.setItemAsync(key, JSON.stringify(value), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  else await SecureStore.deleteItemAsync(key);
}
