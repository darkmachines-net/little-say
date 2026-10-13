/** @file Verifies screen and modal control bounds with system-bar/cutout insets and live rotation. */

import { test, expect, type Locator, type Page } from '@playwright/test';
import { openExistingLibrary } from './existingLibrary';

type Insets = { top: number; bottom: number; left: number; right: number };
const portrait = { width: 390, height: 700 };
const bars: Insets = { top: 48, bottom: 48, left: 0, right: 0 };

async function expectInsideSafeArea(control: Locator, page: Page, insets: Insets) {
  await expect(control).toBeVisible();
  await expect.poll(async () => {
    const box = await control.boundingBox();
    const viewport = page.viewportSize()!;
    return Boolean(box && box.x >= insets.left && box.y >= insets.top
      && box.x + box.width <= viewport.width - insets.right
      && box.y + box.height <= viewport.height - insets.bottom);
  }).toBe(true);
}

test('account and setup navigation stay within system bars', async ({ page, context }) => {
  await page.setViewportSize(portrait);
  const device = await context.newCDPSession(page);
  await device.send('Emulation.setSafeAreaInsetsOverride', { insets: bars });
  await page.goto('/app');
  await expectInsideSafeArea(page.getByRole('button', { name: 'Back', exact: true }), page, bars);
  const guest = page.getByRole('button', { name: 'Continue without an account', exact: true });
  await guest.scrollIntoViewIfNeeded();
  await expectInsideSafeArea(guest, page, bars);
  await guest.click();
  await expectInsideSafeArea(page.getByRole('heading', { name: 'Choose your languages', exact: true }), page, bars);
  const next = page.getByRole('button', { name: 'Continue', exact: true });
  await next.scrollIntoViewIfNeeded();
  await expectInsideSafeArea(next, page, bars);
});

test('long dialogs keep close and save actions safe while insets and orientation change', async ({ page, context }) => {
  await page.setViewportSize(portrait);
  const device = await context.newCDPSession(page);
  await device.send('Emulation.setSafeAreaInsetsOverride', { insets: bars });
  await openExistingLibrary(page);
  await expectInsideSafeArea(page.getByRole('button', { name: 'Parent settings', exact: true }), page, bars);
  await page.getByRole('button', { name: 'Parent settings', exact: true }).click();
  const close = page.getByRole('button', { name: 'Close Parent settings', exact: true });
  const save = page.getByRole('button', { name: 'Save settings', exact: true });
  const scenarios = [
    { viewport: portrait, insets: bars },
    { viewport: portrait, insets: { top: 48, bottom: 24, left: 0, right: 0 } },
    { viewport: { width: 844, height: 390 }, insets: { top: 24, bottom: 24, left: 48, right: 48 } },
    { viewport: portrait, insets: bars },
  ];
  for (const { viewport, insets } of scenarios) {
    await page.setViewportSize(viewport);
    await device.send('Emulation.setSafeAreaInsetsOverride', { insets });
    await expectInsideSafeArea(close, page, insets);
    await expectInsideSafeArea(save, page, insets);
    // Scrolling the body must not move either fixed action under a system bar.
    await page.getByRole('textbox', { name: 'Private server address', exact: true }).scrollIntoViewIfNeeded();
    await expectInsideSafeArea(close, page, insets);
    await expectInsideSafeArea(save, page, insets);
  }
  await save.click();
  await expect(save).toHaveCount(0);

  // The overlay still dismisses from the safe gutter after the wrappers are added.
  await page.getByRole('button', { name: 'Parent settings', exact: true }).click();
  await page.getByTestId('modal-backdrop').click({ position: { x: 4, y: bars.top + 4 } });
  await expect(close).toHaveCount(0);
});

test('play controls and tiles use the inset viewport', async ({ page, context }) => {
  await page.setViewportSize(portrait);
  const device = await context.newCDPSession(page);
  await device.send('Emulation.setSafeAreaInsetsOverride', { insets: bars });
  await openExistingLibrary(page);
  await page.evaluate(() => { Element.prototype.requestFullscreen = async () => {}; });
  await page.getByRole('button', { name: 'Play Farmyard friends', exact: true }).click();
  await expectInsideSafeArea(page.getByTestId('parent-control'), page, bars);
  for (const name of ['Cow', 'Pig', 'Sheep', 'Horse', 'Chicken', 'Duck']) {
    await expectInsideSafeArea(page.getByRole('button', { name, exact: true }), page, bars);
  }
});
