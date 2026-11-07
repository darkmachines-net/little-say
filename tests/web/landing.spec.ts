/** @file Verifies lean public navigation and centered loading without available audio, account links, responsive layout, and installed-app entry. */

import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Navigation must work without audio; real shared-cache playback belongs to trial.spec.ts.
  await page.route('**/api/speech', route => route.fulfill({ status: 401, json: { error: 'Sign in required.' } }));
});

test('trial code preloads on focus and opens with a centered spinner without reloading the page', async ({ page }) => {
  let release!: () => void;
  let requested = false;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/TryBoards-*.js', async route => { requested = true; await pending; await route.continue(); });
  try {
    await page.goto('/');
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    const link = page.getByRole('link', { name: 'Try Little Say on the web', exact: true });
    await link.focus();
    await expect.poll(() => requested).toBe(true);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await link.press('Enter');
    await expect(page).toHaveURL(/\/app\/try$/);
    const loading = page.getByTestId('web-loading');
    await expect(loading).toBeVisible();
    await expect(loading).toHaveText('');
    await expect(loading).toHaveAttribute('aria-busy', 'true');
    const spinner = page.getByRole('progressbar', { name: 'Loading Little Say', exact: true });
    await expect(spinner).toBeVisible();
    const viewport = page.viewportSize()!;
    const bounds = (await spinner.boundingBox())!;
    expect(bounds.x + bounds.width / 2).toBeCloseTo(viewport.width / 2, 0);
    expect(bounds.y + bounds.height / 2).toBeCloseTo(viewport.height / 2, 0);
    await page.screenshot({ path: 'artifacts/screenshots/trial/loading.png' });
    release();
    await expect(page.getByRole('heading', { name: 'Try a starter board', exact: true })).toBeVisible();
    await expect(loading).toHaveCount(0);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.goForward();
    await expect(page.getByRole('heading', { name: 'Try a starter board', exact: true })).toBeVisible();
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
    const scripts = await page.evaluate(() => performance.getEntriesByType('resource').filter(entry => /\/web\/.*\.js$/.test(entry.name)).map(entry => ({ url: entry.name, bytes: (entry as PerformanceResourceTiming).decodedBodySize })));
    expect(scripts.some(script => /\/App-/.test(script.url))).toBe(false);
    // Keep cold public entry under 1.5 MB before compression; editor/catalog/identity code belongs to App.
    expect(scripts.reduce((total, script) => total + script.bytes, 0)).toBeLessThan(1_500_000);
  } finally { release(); }
});

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
    await expect(page.getByRole('link', { name: 'Log in', exact: true })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('link', { name: 'Create account', exact: true })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('link', { name: 'Google Play — Coming soon', exact: true })).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
    expect(apiRequests).toEqual([]);
    await page.screenshot({ path: `artifacts/screenshots/landing/home-${viewport.width}.png` });
    await page.getByRole('link', { name: 'Try Little Say on the web', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/try$/);
    await expect(page.getByRole('heading', { name: 'Try a starter board', exact: true })).toBeVisible();
    await expect(page.locator('.ls-site')).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Try a starter board', exact: true })).toBeVisible();
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
  await expect(page).toHaveURL(/\/app\/try$/);
  await page.goto('/app/');
  await expect(page.getByRole('heading', { name: 'Little Say: Learn to Talk!', exact: true })).toBeVisible();
});

test('landing account links open the requested form directly and preserve Back', async ({ page }) => {
  for (const [label, path, heading] of [['Log in', 'login', 'Sign in'], ['Create account', 'register', 'Create an account']]) {
    await page.goto('/');
    const link = page.getByRole('link', { name: label, exact: true });
    await expect(link).toHaveAttribute('href', `/app/account/${path}`);
    await link.focus(); await link.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/app/account/${path}$`));
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('link', { name: 'Try Little Say on the web', exact: true })).toBeVisible();
  }
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
  await expect(page).toHaveURL(/\/app\/try$/);
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
