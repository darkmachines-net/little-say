/** @file Verifies account, Settings, modal and unlocked/locked play controls stay within system-bar/cutout insets and live rotation. */

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
  // Keep the opening animation active while the web provider measures its viewport-relative insets.
  await page.route('**/app', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('</head>', '<style>* { animation-duration: 1s !important; }</style></head>') });
  });
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

test('Settings navigation stays safe while scrolling and rotating its pages', async ({ page, context }) => {
  await page.setViewportSize(portrait);
  const device = await context.newCDPSession(page);
  await device.send('Emulation.setSafeAreaInsetsOverride', { insets: bars });
  await openExistingLibrary(page);
  await expectInsideSafeArea(page.getByRole('button', { name: 'Settings', exact: true }), page, bars);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  for (const { viewport, insets } of [
    { viewport: portrait, insets: bars },
    { viewport: portrait, insets: { top: 48, bottom: 24, left: 0, right: 0 } },
    { viewport: { width: 844, height: 390 }, insets: { top: 24, bottom: 24, left: 48, right: 48 } },
    { viewport: portrait, insets: bars },
  ]) {
    await page.setViewportSize(viewport);
    await device.send('Emulation.setSafeAreaInsetsOverride', { insets });
    await expectInsideSafeArea(page.getByRole('button', { name: 'Boards', exact: true }), page, insets);
    const privacy = page.getByRole('button', { name: 'Privacy Policy', exact: true });
    await privacy.scrollIntoViewIfNeeded();
    await expectInsideSafeArea(privacy, page, insets);
    await privacy.click();
    await page.getByRole('heading', { name: 'Account deletion', exact: true }).scrollIntoViewIfNeeded();
    const back = page.getByRole('button', { name: 'Settings', exact: true });
    await expectInsideSafeArea(back, page, insets);
    await back.click();
  }
});

test('long dialogs keep close and save actions safe while insets and orientation change', async ({ page, context }) => {
  await page.setViewportSize(portrait);
  const device = await context.newCDPSession(page);
  await device.send('Emulation.setSafeAreaInsetsOverride', { insets: bars });
  await openExistingLibrary(page);
  await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
  await page.getByRole('button', { name: 'Edit tile Cow', exact: true }).click();
  const close = page.getByRole('button', { name: 'Close Edit tile', exact: true });
  const save = page.getByRole('button', { name: 'Save tile', exact: true });
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
    await page.getByRole('button', { name: 'Duplicate tile', exact: true }).scrollIntoViewIfNeeded();
    await expectInsideSafeArea(close, page, insets);
    await expectInsideSafeArea(save, page, insets);
  }
  await save.click();
  await expect(save).toHaveCount(0);

  // The overlay still dismisses from the safe gutter after the wrappers are added.
  await page.getByRole('button', { name: 'Edit tile Cow', exact: true }).click();
  await page.getByTestId('modal-backdrop').click({ position: { x: 4, y: bars.top + 4 } });
  await expect(close).toHaveCount(0);
});

test('play controls and tiles use the inset viewport', async ({ page, context }) => {
  await page.setViewportSize(portrait);
  const device = await context.newCDPSession(page);
  await device.send('Emulation.setSafeAreaInsetsOverride', { insets: bars });
  await page.addInitScript(() => {
    Object.defineProperty(window.speechSynthesis, 'getVoices', { configurable: true, value: () => [
      { voiceURI: 'safe-area-en', name: 'Test English', lang: 'en-US', localService: true, default: true },
    ] });
    Element.prototype.requestFullscreen = async () => {};
  });
  await openExistingLibrary(page);
  await page.getByRole('button', { name: 'Play Farmyard friends', exact: true }).click();
  await expectInsideSafeArea(page.getByTestId('board-back'), page, bars);
  const lock = page.getByTestId('board-lock');
  await expectInsideSafeArea(lock, page, bars);
  await lock.click();
  await expect(page.getByTestId('board-back')).toHaveCount(0);
  await expectInsideSafeArea(page.getByTestId('parent-control'), page, bars);
  for (const name of ['Cow', 'Pig', 'Sheep', 'Horse', 'Chicken', 'Duck']) {
    await expectInsideSafeArea(page.getByRole('button', { name, exact: true }), page, bars);
  }
});
