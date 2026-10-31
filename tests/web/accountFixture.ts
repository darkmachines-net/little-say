/** @file Creates isolated verified emulator accounts and signs browser feature tests into the real account flow. */
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

/** Sign in through the app and await its first cloud sync before continuing to setup or cached boards. */
export async function openSignedInApp(page: Page) {
  const credentials = await createTestAccount();
  await page.goto('/app/account/login');
  await page.getByLabel('Email', { exact: true }).fill(credentials.email);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('All boards and assets are synced.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to boards', exact: true }).click();
  return credentials;
}
