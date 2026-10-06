/** @file Keeps opted-in account metadata separate from device libraries; Firebase refresh credentials use the separate SecureStore adapter. */
import { accountSchema, authConfigSchema, type Account, type AuthConfig } from '@little-say/core';
import * as SecureStore from 'expo-secure-store';
export type AccountSession = { account: Account; server: string; firebaseUid: string; authConfig: AuthConfig };
const key = 'little-say-firebase-account';
/** Restore a Firebase-era session only; no legacy credentials or device library data are migrated. */
export async function loadAccountSession(): Promise<AccountSession | null> {
  const raw = await SecureStore.getItemAsync(key);
  if (!raw) return null;
  const value = JSON.parse(raw) as AccountSession;
  if (!value.server || !value.firebaseUid) return null;
  return { account: accountSchema.parse(value.account), server: value.server, firebaseUid: value.firebaseUid, authConfig: authConfigSchema.parse(value.authConfig) };
}
/** Remember consent for exactly this backend, or disconnect without changing any local boards. */
export async function saveAccountSession(value: AccountSession | null): Promise<void> {
  if (value) await SecureStore.setItemAsync(key, JSON.stringify(value), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }); else await SecureStore.deleteItemAsync(key);
}
