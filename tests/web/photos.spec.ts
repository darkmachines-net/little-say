/** @file Checks photo import and crop consistency through saving, quiet saved state, and the grouped Accept action. */

import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { openExistingLibrary } from './existingLibrary';

// Deliberately asymmetric fixture: a face on the right makes unwanted recropping
// obvious without putting a real person's photo in tests or screenshots.
async function photoFile(page: Page) {
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#B8DFF4'; c.fillRect(0, 0, 1200, 800); c.fillStyle = '#B4DBBD'; c.fillRect(0, 580, 1200, 220);
    c.fillStyle = '#EFCE6F'; c.beginPath(); c.arc(190, 160, 80, 0, 2 * Math.PI); c.fill();
    c.fillStyle = '#8F78BA'; c.beginPath(); c.ellipse(840, 770, 215, 250, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#654638'; c.beginPath(); c.ellipse(840, 340, 185, 230, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#F4C6A2'; c.beginPath(); c.ellipse(840, 365, 142, 165, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#453331'; for (const x of [790, 890]) { c.beginPath(); c.arc(x, 345, 10, 0, 2 * Math.PI); c.fill(); }
    c.strokeStyle = '#A45555'; c.lineWidth = 10; c.beginPath(); c.arc(840, 390, 49, 0.25, Math.PI - 0.25); c.stroke();
    return canvas.toDataURL('image/png').split(',')[1];
  });
  return { name: 'family-fixture.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') };
}
async function choose(page: Page, name = 'Choose photo') {
  const file = await photoFile(page);
  const picker = page.waitForEvent('filechooser'); await page.getByRole('button', { name, exact: true }).click(); await (await picker).setFiles(file);
  await expect(page.getByRole('heading', { name: 'Crop photo', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use photo', exact: true })).toBeEnabled();
}
async function saveTile(page: Page) {
  await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  await expect(page.getByTestId('board-save-status')).toHaveCount(0);
}
async function region(frame: Locator) {
  const f = (await frame.boundingBox())!, i = (await frame.getByTestId('photo-image').boundingBox())!;
  expect(Math.abs(f.width - f.height)).toBeLessThan(0.1);
  return [(f.x - i.x) / i.width, (f.y - i.y) / i.height, f.width / i.width, f.height / i.height];
}
async function sameRegion(frame: Locator, expected: number[]) {
  await expect(async () => { const actual = await region(frame); actual.forEach((n, i) => expect(n).toBeCloseTo(expected[i], 3)); }).toPass();
}
async function storedPhotos(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('little-say'); r.onsuccess = () => resolve(r.result); });
    const library = await new Promise<any>(resolve => { const r = db.transaction('state').objectStore('state').get('library'); r.onsuccess = () => resolve(r.result); }); db.close();
    return library.boards[0].tiles.map((t: any) => ({ label: t.label, illustration: t.illustration }));
  });
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { Element.prototype.requestFullscreen = async () => {}; });
  await openExistingLibrary(page);
  await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
  await page.getByRole('button', { name: 'Edit tile Cow', exact: true }).click();
});

test('fine crop controls match the final photo in the editor, library and rotated offline play board', async ({ page, context }) => {
  await page.getByRole('textbox', { name: 'Words on the tile', exact: true }).fill('Mama');
  await choose(page);
  const crop = page.getByTestId('photo-crop-surface');
  const slider = page.getByRole('slider', { name: 'Photo zoom', exact: true });
  await slider.focus(); await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveValue('1.01'); // one-percent rather than the old 25% jumps
  await page.getByRole('button', { name: 'Reset crop', exact: true }).click();
  await crop.focus(); for (let i = 0; i < 8; i++) await page.keyboard.press('+');
  const bounds = (await crop.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 - 95, bounds.y + bounds.height / 2 + 20, { steps: 15 }); await page.mouse.up();
  const expected = await region(crop);
  await mkdir('artifacts/screenshots', { recursive: true });
  await page.screenshot({ path: 'artifacts/screenshots/photo-crop.png' });
  await page.getByRole('button', { name: 'Use photo', exact: true }).click();
  await sameRegion(page.getByTestId('tile-photo-preview').getByTestId('photo-frame'), expected);
  await page.screenshot({ path: 'artifacts/screenshots/photo-tile-preview.png' });
  await saveTile(page);
  await sameRegion(page.getByRole('button', { name: 'Edit tile Mama', exact: true }).getByTestId('photo-frame'), expected);
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await sameRegion(page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).getByTestId('photo-frame'), expected);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true); await page.reload();
  await page.getByRole('button', { name: 'Play Farmyard friends', exact: true }).click();
  if (await page.getByRole('button', { name: 'Continue to board', exact: true }).isVisible()) await page.getByRole('button', { name: 'Continue to board', exact: true }).click();
  for (const size of [{ width: 820, height: 1180 }, { width: 1180, height: 820 }]) {
    await page.setViewportSize(size);
    await sameRegion(page.getByRole('button', { name: 'Mama', exact: true }).getByTestId('photo-frame'), expected);
    await page.screenshot({ path: `artifacts/screenshots/photo-play-${size.width}.png` });
  }
});

test('pinch zoom and one-finger repositioning work without scrolling the crop away', async ({ page, context }) => {
  await page.setViewportSize({ width: 820, height: 1180 }); await choose(page);
  const crop = page.getByTestId('photo-crop-surface'), bounds = (await crop.boundingBox())!;
  const session = await context.newCDPSession(page);
  const x = Math.round(bounds.x + bounds.width / 2), y = Math.round(bounds.y + bounds.height / 2);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - 50, y, id: 1 }, { x: x + 50, y, id: 2 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 100, y, id: 1 }, { x: x + 100, y, id: 2 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByRole('slider', { name: 'Photo zoom' })).toHaveValue('2');
  const before = await region(crop);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 3 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 30, y: y + 10, id: 3 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const after = await region(crop); expect(after[0]).toBeGreaterThan(before[0]); expect(after[1]).toBeLessThan(before[1]);
  expect((await crop.boundingBox())!.y).toBe(bounds.y);
  await page.getByRole('button', { name: 'Use photo', exact: true }).click(); await saveTile(page);
  expect((await storedPhotos(page))[0].illustration.zoom).toBe(2);
});

test('cancelled crops and replacement uploads preserve the saved photo, including after reload', async ({ page }) => {
  await choose(page); await page.getByTestId('photo-crop-surface').focus(); await page.keyboard.press('+');
  await page.getByRole('button', { name: 'Use photo', exact: true }).click(); await saveTile(page);
  const original = (await storedPhotos(page))[0].illustration;
  await page.getByRole('button', { name: 'Edit tile Cow', exact: true }).click();
  await page.getByRole('button', { name: 'Adjust crop', exact: true }).click();
  await page.getByRole('button', { name: 'Reset crop', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await choose(page, 'Change photo'); await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await saveTile(page);
  expect((await storedPhotos(page))[0].illustration).toEqual(original);
  await page.reload();
  if (!page.url().includes('/edit')) await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click(); await page.getByRole('button', { name: 'Edit tile Cow', exact: true }).click();
  await page.getByRole('button', { name: 'Adjust crop', exact: true }).click(); await expect(page.getByText('105%', { exact: true })).toBeVisible();
});

test('duplicate family cards can frame different people without modifying their shared image', async ({ page }) => {
  await choose(page); await page.getByRole('button', { name: 'Use photo', exact: true }).click();
  await page.getByRole('textbox', { name: 'Words on the tile', exact: true }).fill('Mama'); await saveTile(page);
  const original = (await storedPhotos(page))[0].illustration;
  await page.getByRole('button', { name: 'Edit tile Mama', exact: true }).click();
  await page.getByRole('button', { name: 'Duplicate tile', exact: true }).click();
  await page.getByRole('button', { name: 'Edit tile Mama', exact: true }).last().click();
  await page.getByRole('textbox', { name: 'Words on the tile', exact: true }).fill('Papa');
  await page.getByRole('button', { name: 'Adjust crop', exact: true }).click();
  await page.getByTestId('photo-crop-surface').focus(); await page.keyboard.press('+'); await page.keyboard.press('ArrowLeft');
  await page.getByRole('button', { name: 'Use photo', exact: true }).click(); await saveTile(page);
  const photos = await storedPhotos(page);
  expect(photos[0].illustration).toEqual(original);
  expect(photos.at(-1).illustration.assetId).toBe(original.assetId);
  expect(photos.at(-1).illustration.zoom).toBeGreaterThan(original.zoom);
  expect(photos.at(-1).illustration.x).not.toBe(original.x);
});
