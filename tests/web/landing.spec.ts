/** @file Verifies the single-screen web welcome, reachable entry on short screens, inactive store links, and installed-web-app compatibility. */

import { test, expect } from '@playwright/test';

for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
  test(`homepage describes the app without starting it at ${viewport.width}px`, async ({ page }) => {
    const apiRequests: string[] = [];
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()); });
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Little SayLearn to Talk!');
    await expect(page.getByText('Make your own custom speaking soundboards for learning new words in seconds.')).toBeVisible();
    await expect(page.getByText("Free with no ads to support your child's learning.")).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Choose your languages', exact: true })).toHaveCount(0);
    for (const store of ['App Store', 'Google Play']) {
      const links = page.getByRole('link', { name: `${store} — Coming soon`, exact: true });
      await expect(links).toHaveCount(1);
      for (const link of await links.all()) {
        await expect(link).toHaveAttribute('aria-disabled', 'true');
        expect(await link.getAttribute('href')).toBeNull();
      }
    }
    await expect(page.locator('.ls-site')).toBeVisible();
    expect(await page.locator('.ls-site').evaluate(element => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight)).toBe(true);
    await expect(page.getByRole('link', { name: 'Try Little Say on the web', exact: true })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('link', { name: 'Google Play — Coming soon', exact: true })).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
    expect(apiRequests).toEqual([]);
    await page.screenshot({ path: `artifacts/screenshots/landing/home-${viewport.width}.png` });
    await page.getByRole('link', { name: 'Try Little Say on the web', exact: true }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole('heading', { name: 'Little Say: Learn to Talk!', exact: true })).toBeVisible();
    await expect(page.locator('.ls-site')).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Little Say: Learn to Talk!', exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Little SayLearn to Talk!');
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
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Try Little Say on the web', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/app$/);
  await page.goto('/app/');
  await expect(page.getByRole('heading', { name: 'Little Say: Learn to Talk!', exact: true })).toBeVisible();
});

test('short windows and enlarged text keep the web entry reachable by scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 568, height: 320 });
  await page.goto('/');
  await page.addStyleTag({ content: '.ls-copy { font-size: 32px; } .ls-copy h1 span, .ls-copy p, .ls-copy a, .ls-copy small, .ls-copy strong { font-size: inherit; }' });
  const site = page.locator('.ls-site');
  expect(await site.evaluate(element => element.scrollWidth <= element.clientWidth && element.scrollHeight > element.clientHeight)).toBe(true);
  const entry = page.getByRole('link', { name: 'Try Little Say on the web', exact: true });
  await entry.scrollIntoViewIfNeeded();
  await expect(entry).toBeInViewport({ ratio: 1 });
  const store = page.getByRole('link', { name: 'Google Play — Coming soon', exact: true });
  await store.scrollIntoViewIfNeeded();
  await expect(store).toBeInViewport({ ratio: 1 });
  await entry.click();
  await expect(page).toHaveURL(/\/app$/);
});

test('older iOS home-screen installs bypass the homepage at their original root URL', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Little Say: Learn to Talk!', exact: true })).toBeVisible();
  await expect(page.locator('.ls-site')).toHaveCount(0);
});

test('standalone display mode also bypasses the homepage for older installs', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = query => query === '(display-mode: standalone)'
      ? Object.defineProperty(original(query), 'matches', { value: true }) : original(query);
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Little Say: Learn to Talk!', exact: true })).toBeVisible();
  await expect(page.locator('.ls-site')).toHaveCount(0);
});
