/** @file Creates isolated verified accounts and leaves the status-first account screen after its initial backup succeeds. */
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

/** Sign in through the app, await its first cloud sync, then use header Back to reach setup or cached boards. */
export async function openSignedInApp(page: Page) {
  const credentials = await createTestAccount();
  await page.goto('/app/account/login');
  await page.getByLabel('Email', { exact: true }).fill(credentials.email);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Up to date', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  return credentials;
}
