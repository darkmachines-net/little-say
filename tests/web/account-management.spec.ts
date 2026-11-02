/** @file Verifies Settings account groups, offline/startup-failure recovery, management history, and credential lifetimes with isolated services. */
import { expect, test } from '@playwright/test';
import { openSignedInApp } from './accountFixture';

test('Settings groups account actions without a backup status card and management pages support history without retaining credentials', async ({ page }) => {
  const credentials = await openSignedInApp(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByTestId('backup-status')).toHaveCount(0);
    await expect(page.getByText(credentials.email, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue to boards', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 390) await page.screenshot({ path: test.info().outputPath('account-status-phone.png'), animations: 'disabled' });
  }
  await page.getByRole('button', { name: 'Sign-in methods', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/settings\/account\/sign-in-methods$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign-in methods', exact: true })).toBeVisible();
  await expect(page.getByLabel('Current password', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/settings$/);
  await page.getByRole('button', { name: 'Delete account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Permanently delete account', exact: true })).toBeDisabled();
  await page.getByLabel('Current password', { exact: true }).fill('not-a-real-password');
  await page.goBack(); await page.goForward();
  await expect(page.getByLabel('Current password', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Cancel deletion', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByText('You’ll need to sign in to use Little Say.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stay signed in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
});

test('only failed backup exposes recovery in the Account group', async ({ page }) => {
  await openSignedInApp(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.context().setOffline(true);
  await expect(page.getByTestId('backup-status')).toHaveCount(0);
  await page.context().setOffline(false);
  await expect(page.getByTestId('backup-status')).toHaveCount(0);
  await page.route('**/api/account/backup', route => route.fulfill({ status: 503, json: { error: 'Backup temporarily unavailable.' } }));
  await page.reload(); // A fresh launch checks the server even when the previous sync was recent.
  await page.getByRole('button', { name: 'Backup needs attention', exact: true }).click();
  await expect(page.getByText('Backup temporarily unavailable.', { exact: true })).toBeVisible();
  await page.unroute('**/api/account/backup');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Up to date', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Backup needs attention', exact: true })).toHaveCount(0);
});

test('legacy account links resolve into Settings and management deep links keep their logical parent', async ({ page }) => {
  await openSignedInApp(page);
  for (const path of ['/app/account', '/app/settings/account']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/app\/settings$/);
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  }
  await page.goto('/app/account/backup');
  await expect(page).toHaveURL(/\/app\/settings\/backup$/);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/settings$/);
  await page.goto('/app/account/delete');
  await expect(page).toHaveURL(/\/app\/settings\/account\/delete$/);
  await expect(page.getByRole('button', { name: 'Permanently delete account', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel deletion', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/settings$/);
});
