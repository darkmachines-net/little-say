/** @file Verifies single-row headers, home-only branding, Back/route titles, actions, draft exits, and full-screen play. */

import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { openExistingLibrary } from './existingLibrary';

async function headerGeometry(page: Page, title?: string, backLabel?: string) {
  const header = page.getByTestId('app-header').last();
  const bar = page.getByTestId('app-header-bar').last();
  const bounds = (await bar.boundingBox())!;
  // A contextual toolbar must not create a second row beneath the navigation bar.
  expect((await header.boundingBox())!.height).toBe(bounds.height + 1);
  if (title) {
    const heading = page.getByRole('heading', { name: title, exact: true });
    await expect(heading).toHaveCount(1);
    await expect(bar.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(bar.locator('img')).toHaveCount(0);
    const headingBox = (await heading.boundingBox())!;
    expect(headingBox.y).toBeGreaterThanOrEqual(bounds.y);
    expect(headingBox.y + headingBox.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    if (backLabel) {
      const back = (await bar.getByRole('button', { name: backLabel, exact: true }).boundingBox())!;
      expect(back.x + back.width).toBeLessThanOrEqual(headingBox.x);
      for (const button of await bar.getByRole('button').all()) {
        if (await button.getAttribute('aria-label') === backLabel) continue;
        expect((await button.boundingBox())!.x).toBeGreaterThanOrEqual(headingBox.x + headingBox.width);
      }
    }
  } else {
    await expect(bar.getByText('Little Say', { exact: true })).toBeVisible();
    await expect(bar.locator('img')).toBeVisible();
  }
  for (const button of await bar.getByRole('button').all()) {
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  return { height: bounds.height, x: bounds.x, width: bounds.width };
}

for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  test(`parent pages use one conventional navigation row at ${viewport.width} units`, async ({ page }) => {
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
    expect(await headerGeometry(page, 'Settings', 'Boards')).toEqual(dashboard);
    await page.screenshot({ path: `artifacts/screenshots/headers/settings-${viewport.width}.png` });
    await page.getByRole('button', { name: 'Languages', exact: true }).click();
    expect(await headerGeometry(page, 'Languages', 'Settings')).toEqual(dashboard);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Account & backup', exact: true }).click();
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    expect(await headerGeometry(page, 'Log in', 'Back')).toEqual(dashboard);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Boards', exact: true }).click();
    await page.getByRole('button', { name: 'New board', exact: true }).click();
    expect(await headerGeometry(page, 'New board', 'Back to boards')).toEqual(dashboard);
    await page.screenshot({ path: `artifacts/screenshots/headers/ai-${viewport.width}.png` });
    await page.getByRole('button', { name: 'Picture settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Picture settings', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close Picture settings', exact: true }).click();
    await page.getByRole('button', { name: 'Back to boards', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Save your draft?', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
    expect(await headerGeometry(page, 'Edit board', 'Boards')).toEqual(dashboard);
    await expect(page.getByRole('heading', { name: 'Edit board', exact: true })).toBeFocused();
    expect(await page.getByRole('heading', { name: 'Edit board', exact: true }).getByText('Edit board', { exact: true }).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(page.getByTestId('app-header').getByRole('button', { name: 'Languages', exact: true })).toHaveCount(0);
    await page.screenshot({ path: `artifacts/screenshots/headers/editor-${viewport.width}.png` });
    await page.getByRole('button', { name: 'Languages', exact: true }).click();
    await page.getByRole('button', { name: 'Close Board languages', exact: true }).click();
    await page.getByRole('button', { name: 'Play board', exact: true }).click();
    await expect(page.getByTestId('play-board')).toBeVisible();
    await expect(page.getByTestId('app-header')).toHaveCount(0);
    await expect(page.getByTestId('board-back')).toBeVisible();
  });
}

test('account and setup use route headings and compact single rows after a phone resize', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/app');
  await expect(page.getByRole('button', { name: 'Continue without an account', exact: true })).toBeVisible();
  const desktop = await headerGeometry(page, 'Welcome to Little Say', 'Back');
  await page.setViewportSize({ width: 320, height: 740 });
  await expect.poll(async () => (await page.getByTestId('app-header-bar').last().boundingBox())!.height).toBeLessThan(desktop.height);
  const phone = await headerGeometry(page, 'Welcome to Little Say', 'Back');
  expect(phone.height).toBeLessThan(desktop.height);
  await page.getByRole('button', { name: 'Continue without an account', exact: true }).click();
  expect(await headerGeometry(page, 'Set up Little Say')).toEqual(phone);
  await page.getByRole('button', { name: 'Sign in or restore boards', exact: true }).click();
  expect(await headerGeometry(page, 'Welcome to Little Say', 'Back')).toEqual(phone);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose your languages', exact: true })).toBeVisible();
});
