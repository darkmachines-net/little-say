/** @file Verifies website-only marketing, inactive store links, direct app access, and installed-web-app compatibility. */

import { test, expect } from '@playwright/test';

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
  test(`homepage describes the app without starting it at ${viewport.width}px`, async ({ page }) => {
    const apiRequests: string[] = [];
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()); });
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Little words.Big possibilities.');
    await expect(page.getByRole('heading', { name: 'Choose your languages', exact: true })).toHaveCount(0);
    for (const store of ['App Store', 'Google Play']) {
      const links = page.getByRole('link', { name: `${store} — Coming soon`, exact: true });
      await expect(links).toHaveCount(2);
      for (const link of await links.all()) {
        await expect(link).toHaveAttribute('aria-disabled', 'true');
        expect(await link.getAttribute('href')).toBeNull();
      }
    }
    await expect(page.locator('.ls-site')).toBeVisible();
    expect(await page.locator('.ls-site').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
    expect(apiRequests).toEqual([]);
    await page.screenshot({ path: `artifacts/screenshots/landing/home-${viewport.width}.png` });
    await page.getByRole('heading', { name: 'Familiar faces. Favorite things.', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `artifacts/screenshots/landing/features-${viewport.width}.png` });
    await page.getByRole('heading', { name: 'Make room for their words.', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `artifacts/screenshots/landing/stores-${viewport.width}.png` });
    await page.getByRole('link', { name: 'Try Little Say on the web', exact: true }).last().click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole('heading', { name: 'Choose your languages', exact: true })).toBeVisible();
    await expect(page.locator('.ls-site')).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Choose your languages', exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Little words.Big possibilities.');
  });
}

test('homepage navigation works with a keyboard and installed web apps launch into the app', async ({ page, request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ id: '/', start_url: '/app', scope: '/' });
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await page.goto('/');
  await page.getByRole('link', { name: 'Features', exact: true }).click();
  await expect(page).toHaveURL(/#features$/);
  await expect(page.getByRole('heading', { name: /Small touches\.\s*So many ways to connect\./ })).toBeInViewport();
  await page.goto('/app/');
  await expect(page.getByRole('heading', { name: 'Choose your languages', exact: true })).toBeVisible();
});

test('older iOS home-screen installs bypass the homepage at their original root URL', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Choose your languages', exact: true })).toBeVisible();
  await expect(page.locator('.ls-site')).toHaveCount(0);
});

test('standalone display mode also bypasses the homepage for older installs', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = query => query === '(display-mode: standalone)'
      ? Object.defineProperty(original(query), 'matches', { value: true }) : original(query);
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Choose your languages', exact: true })).toBeVisible();
  await expect(page.locator('.ls-site')).toHaveCount(0);
});
