/** @file Verifies responsive account status, routed management, credential lifetime, and connection/retry states against isolated test services. */
import { expect, test } from '@playwright/test';
import { openSignedInApp } from './accountFixture';

test('account overview stays concise and management pages support history without retaining credentials', async ({ page }) => {
  const credentials = await openSignedInApp(page);
  await page.getByRole('button', { name: 'Account & backup', exact: true }).click();
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole('heading', { name: 'Up to date', exact: true })).toBeVisible();
    await expect(page.getByText(credentials.email, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue to boards', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 390) await page.screenshot({ path: test.info().outputPath('account-status-phone.png'), animations: 'disabled' });
  }
  await page.getByRole('button', { name: 'Backup details', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/account\/backup$/);
  await expect(page.getByText('Photos & illustrations', { exact: true })).toBeVisible();
  await page.goBack();
  await page.getByRole('button', { name: 'Sign-in methods', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/account\/sign-in-methods$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign-in methods', exact: true })).toBeVisible();
  await expect(page.getByLabel('Current password', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/account$/);
  await page.getByRole('button', { name: 'Delete account…', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Permanently delete account', exact: true })).toBeDisabled();
  await page.getByLabel('Current password', { exact: true }).fill('not-a-real-password');
  await page.goBack(); await page.goForward();
  await expect(page.getByLabel('Current password', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Cancel deletion', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByText('You’ll need to sign in to use Little Say.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stay signed in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Account & backup', exact: true })).toBeVisible();
});

test('connection and server failures replace old success status and recover through retry', async ({ page }) => {
  await openSignedInApp(page);
  await page.getByRole('button', { name: 'Account & backup', exact: true }).click();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.context().setOffline(true);
  await expect(page.getByRole('heading', { name: 'Waiting for connection', exact: true })).toBeVisible();
  await page.context().setOffline(false);
  await expect(page.getByRole('heading', { name: 'Up to date', exact: true })).toBeVisible();
  await page.route('**/api/account/backup', route => route.fulfill({ status: 503, json: { error: 'Backup temporarily unavailable.' } }));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('heading', { name: 'Backup needs attention', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Backup details', exact: true }).click();
  await expect(page.getByText('Backup temporarily unavailable.', { exact: true })).toBeVisible();
  await page.unroute('**/api/account/backup');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Up to date', exact: true })).toBeVisible();
});
