/** @file Creates existing verified emulator accounts with empty backups and waits for Home entry through the real sign-in flow. */
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { expect, type Page } from '@playwright/test';

/** Create an existing verified account with an empty backup on the owned loopback services, preserving legacy-device setup fixtures. */
export async function createTestAccount() {
  if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')) throw new Error('Browser fixtures require the owned loopback Auth emulator.');
  const app = initializeApp({ projectId: 'demo-little-say' }, randomUUID());
  const credentials = { email: `${randomUUID()}@example.test`, password: 'a test family passphrase' };
  try { await getAuth(app).createUser({ ...credentials, emailVerified: true }); } finally { await deleteApp(app); }
  // These scenarios own their board fixtures. New-account starter coverage uses real registration.
  const authResponse = await fetch('http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST + '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...credentials, returnSecureToken: true }),
  });
  if (!authResponse.ok) throw new Error('Could not authenticate the existing-account fixture.');
  const { idToken } = await authResponse.json();
  const origin = `http://127.0.0.1:${process.env.TEST_API_PORT || '4175'}`;
  const headers = { 'Content-Type': 'application/json', 'X-Little-Say': '1', Authorization: `Bearer ${idToken}` };
  const session = await fetch(origin + '/api/account/session', { method: 'POST', headers, body: JSON.stringify({ idToken, native: true }) });
  if (!session.ok) throw new Error('Could not provision the existing-account fixture.');
  const backup = await fetch(origin + '/api/account/backup', { method: 'POST', headers, body: JSON.stringify({ revision: 0, boards: [], assets: [] }) });
  if (!backup.ok) throw new Error('Could not initialize the existing-account fixture backup.');
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
