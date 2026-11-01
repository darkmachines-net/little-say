/** @file Verifies accessible account icons keep setup and dashboard headers on one row after responsive layout settles. */
import { expect, test } from '@playwright/test';
import { openSignedInApp } from './accountFixture';

test('account icon stays compact in setup and dashboard headers and opens account navigation', async ({ page }) => {
  await openSignedInApp(page);
  for (const stage of ['setup', 'dashboard']) {
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      const container = page.getByTestId('app-header-bar'), account = container.getByRole('button', { name: 'Account & backup', exact: true });
      await expect(account).toHaveText('');
      // React Native applies its Dimensions update after the browser viewport changes.
      await expect.poll(async () => (await container.boundingBox())?.height).toBe(width < 600 ? 64 : 76);
      const box = (await account.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(width - 20);
    }
    if (stage === 'setup') {
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByRole('button', { name: 'Start without starter boards', exact: true }).click();
    }
  }
  await page.getByRole('button', { name: 'Account & backup', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Account & backup', exact: true })).toBeVisible();
});
