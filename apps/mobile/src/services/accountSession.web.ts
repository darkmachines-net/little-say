/** @file Remembers browser account identity only; session credentials live exclusively in an HttpOnly server cookie. */

import { type Account } from '@little-say/core';
export type AccountSession = { account: Account; server: string; token?: string };
const key = 'little-say-account';
/** Restore non-secret account metadata; no automatic sign-in happens after local sign-out. */
export async function loadAccountSession(): Promise<AccountSession | null> {
  const value = localStorage.getItem(key); return value ? JSON.parse(value) : null;
}
/** Remember the opted-in account while keeping authentication tokens out of JavaScript storage. */
export async function saveAccountSession(value: AccountSession | null): Promise<void> {
  if (value) localStorage.setItem(key, JSON.stringify({ account: value.account, server: value.server }));
  else localStorage.removeItem(key);
}
