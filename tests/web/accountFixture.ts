/** @file Creates isolated verified emulator accounts and waits for automatic Home entry and sync through the real sign-in flow. */
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { expect, type Page } from '@playwright/test';

/** Create a unique verified fixture only on the test runner's owned loopback Auth emulator. */
export async function createTestAccount() {
  if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')) throw new Error('Browser fixtures require the owned loopback Auth emulator.');
  const app = initializeApp({ projectId: 'demo-little-say' }, randomUUID());
  const credentials = { email: `${randomUUID()}@example.test`, password: 'a test family passphrase' };
  try { await getAuth(app).createUser({ ...credentials, emailVerified: true }); } finally { await deleteApp(app); }
  return credentials;
}

/** Sign in through the app, assert automatic Home navigation, and await persisted sync before testing setup or cached boards. */
export async function openSignedInApp(page: Page) {
  const credentials = await createTestAccount();
  await page.goto('/app/account/login');
  await page.getByLabel('Email', { exact: true }).fill(credentials.email);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect.poll(() => page.evaluate(async () => {
    const session = JSON.parse(localStorage.getItem('little-say-firebase-account') || 'null');
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('little-say'); request.onsuccess = () => resolve(request.result); });
    try {
      return await new Promise<boolean>(resolve => {
        const request = db.transaction('state').objectStore('state').get('library');
        request.onsuccess = () => { const sync = request.result?.sync; resolve(Boolean(sync?.savedAt && sync.accountId === session?.account.id && sync.server === session?.server)); };
      });
    } finally { db.close(); }
  })).toBe(true);
  await expect(page.getByText('Syncing your content…', { exact: true })).toHaveCount(0);
  return credentials;
}
