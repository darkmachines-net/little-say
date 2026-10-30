/** @file Keeps opted-in account metadata separate from device libraries; browser credentials remain in HttpOnly cookies. */
import { accountSchema, authConfigSchema, type Account, type AuthConfig } from '@little-say/core';

export type AccountSession = { account: Account; server: string; firebaseUid: string; authConfig: AuthConfig; backupEnabled?: boolean };
const key = 'little-say-firebase-account';
/** Restore a Firebase-era session only; no legacy credentials or device library data are migrated. */
export async function loadAccountSession(): Promise<AccountSession | null> {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const value = JSON.parse(raw) as AccountSession;
  if (!value.server || !value.firebaseUid) return null;
  return { account: accountSchema.parse(value.account), server: value.server, firebaseUid: value.firebaseUid, authConfig: authConfigSchema.parse(value.authConfig), backupEnabled: value.backupEnabled === true };
}
/** Remember consent for exactly this backend, or disconnect without changing any local boards. */
export async function saveAccountSession(value: AccountSession | null): Promise<void> {
  if (value) localStorage.setItem(key, JSON.stringify(value)); else localStorage.removeItem(key);
}
