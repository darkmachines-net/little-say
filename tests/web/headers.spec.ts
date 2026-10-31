/** @file Verifies consistent responsive branding and reachable navigation across parent pages, with separate full-screen play. */

import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { openExistingLibrary } from './existingLibrary';

async function headerGeometry(page: Page) {
  const bar = page.getByTestId('app-header-bar').last();
  await expect(bar.getByText('Little Say', { exact: true })).toBeVisible();
  const mark = bar.locator('img');
  await expect(mark).toBeVisible();
  const bounds = (await bar.boundingBox())!;
  const artwork = (await mark.boundingBox())!;
  for (const button of await page.getByTestId('app-header').last().getByRole('button').all()) {
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  return { height: bounds.height, brandX: artwork.x, markSize: artwork.width };
}

for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  test(`parent pages retain the same brand and masthead at ${viewport.width} units`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      Object.defineProperty(window.speechSynthesis, 'getVoices', { configurable: true, value: () => [
        { voiceURI: 'header-en', name: 'Test English', lang: 'en-US', localService: true },
      ] });
      Element.prototype.requestFullscreen = async () => {};
    });
    await openExistingLibrary(page, { voiceSources: { 'en-US': 'device', 'ru-RU': 'device' } });
    await mkdir('artifacts/screenshots/headers', { recursive: true });
    const dashboard = await headerGeometry(page);
    await page.screenshot({ path: `artifacts/screenshots/headers/home-${viewport.width}.png` });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    expect(await headerGeometry(page)).toEqual(dashboard);
    await page.screenshot({ path: `artifacts/screenshots/headers/settings-${viewport.width}.png` });
    await page.getByRole('button', { name: 'Languages', exact: true }).click();
    expect(await headerGeometry(page)).toEqual(dashboard);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Account & backup', exact: true }).click();
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    expect(await headerGeometry(page)).toEqual(dashboard);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Boards', exact: true }).click();
    await page.getByRole('button', { name: 'New board', exact: true }).click();
    expect(await headerGeometry(page)).toEqual(dashboard);
    await page.screenshot({ path: `artifacts/screenshots/headers/ai-${viewport.width}.png` });
    await page.getByRole('button', { name: 'Picture settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Picture settings', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close Picture settings', exact: true }).click();
    await page.getByRole('button', { name: 'Back to boards', exact: true }).click();
    await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
    expect(await headerGeometry(page)).toEqual(dashboard);
    await page.screenshot({ path: `artifacts/screenshots/headers/editor-${viewport.width}.png` });
    await page.getByRole('button', { name: 'Languages', exact: true }).click();
    await page.getByRole('button', { name: 'Close Board languages', exact: true }).click();
    await page.getByRole('button', { name: 'Play board', exact: true }).click();
    await expect(page.getByTestId('play-board')).toBeVisible();
    await expect(page.getByTestId('app-header')).toHaveCount(0);
    await expect(page.getByTestId('board-back')).toBeVisible();
  });
}

test('account and setup share the masthead and both compact after a phone resize', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/app');
  await expect(page.getByRole('button', { name: 'Continue without an account', exact: true })).toBeVisible();
  const desktop = await headerGeometry(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await expect.poll(async () => (await page.getByTestId('app-header-bar').last().boundingBox())!.height).toBeLessThan(desktop.height);
  const phone = await headerGeometry(page);
  expect(phone.height).toBeLessThan(desktop.height);
  expect(phone.markSize).toBeLessThan(desktop.markSize);
  await page.getByRole('button', { name: 'Continue without an account', exact: true }).click();
  expect(await headerGeometry(page)).toEqual(phone);
  await page.getByRole('button', { name: 'Sign in or restore boards', exact: true }).click();
  expect(await headerGeometry(page)).toEqual(phone);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose your languages', exact: true })).toBeVisible();
});
