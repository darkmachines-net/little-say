/** @file Persists registered browser sign-in metadata without backup preferences; credentials remain in HttpOnly cookies. */
import { accountSchema, authConfigSchema, type Account, type AuthConfig } from '@little-say/core';

export type AccountSession = { account: Account; server: string; firebaseUid: string; authConfig: AuthConfig };
const key = 'little-say-firebase-account';
/** Restore registered Firebase sign-in, rejecting old guest records and discarding retired backup preferences. */
export async function loadAccountSession(): Promise<AccountSession | null> {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const value = JSON.parse(raw) as AccountSession;
  if (!value.server || !value.firebaseUid) return null;
  const account = accountSchema.parse(value.account);
  if (!account.providers.length) return null;
  return { account, server: value.server, firebaseUid: value.firebaseUid, authConfig: authConfigSchema.parse(value.authConfig) };
}
/** Remember sign-in for exactly this backend, or disconnect without changing any local boards. */
export async function saveAccountSession(value: AccountSession | null): Promise<void> {
  if (value) localStorage.setItem(key, JSON.stringify(value)); else localStorage.removeItem(key);
}
