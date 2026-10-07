/**
 * @file Verifies recent-board spotlight ordering and persistent favorite actions in the browser
 * library.
 */

import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { openExistingLibrary } from './existingLibrary';

async function savedLibrary(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('little-say'); request.onsuccess = () => resolve(request.result); });
    const library = await new Promise<any>(resolve => { const request = db.transaction('state').objectStore('state').get('library'); request.onsuccess = () => resolve(request.result); }); db.close(); return library;
  });
}
async function leaveBoard(page: Page) {
  await page.getByTestId('parent-control').focus(); await page.keyboard.down('Enter');
  await expect(page.getByTestId('parent-control')).toHaveText('Release to edit'); await page.keyboard.up('Enter');
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await expect(page.getByText('Your soundboards', { exact: true })).toBeVisible();
}
async function play(page: Page, name: string) {
  await page.getByRole('button', { name: `Play ${name}`, exact: true }).click();
  await expect(page.getByTestId('play-board')).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Element.prototype.requestFullscreen = async () => {};
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => ['en-US', 'ru-RU'].map(lang => ({ voiceURI: lang, name: lang, lang, localService: true })),
      cancel() {}, speak() {}, addEventListener() {}, removeEventListener() {},
    } });
  });
  await openExistingLibrary(page);
});

test('recent play order persists offline and stays independent of edits, undo, copies and deletion', async ({ page, context }) => {
  const titles = page.getByTestId('board-card-title');
  await expect(titles).toHaveText(['Farmyard friends', 'My little words', 'Our family']);
  await expect(page.getByTestId('recent-board')).toHaveCount(0);
  await play(page, 'Farmyard friends'); await leaveBoard(page);
  await play(page, 'Our family'); await page.reload();
  await expect(page.getByTestId('play-board')).toBeVisible(); await leaveBoard(page);
  await expect(titles).toHaveText(['Our family', 'Farmyard friends', 'My little words']);
  await expect(page.getByTestId('recent-board').getByRole('button', { name: 'Play Our family', exact: true })).toHaveText('Play again');
  const before = await savedLibrary(page);
  expect(before.boards.map((board: any) => board.revision)).toEqual([0, 0, 0]);
  expect(before.boardLastPlayedAt['starter-family']).toBeGreaterThan(before.boardLastPlayedAt['starter-farm']);
  await page.evaluate(() => navigator.serviceWorker.ready); await context.setOffline(true); await page.reload();
  await expect(titles).toHaveText(['Our family', 'Farmyard friends', 'My little words']);
  await page.getByRole('button', { name: 'Edit My little words', exact: true }).click();
  await page.getByRole('textbox', { name: 'Board title', exact: true }).fill('Everyday words');
  await page.getByRole('button', { name: 'Undo last board change', exact: true }).click();
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await expect(titles).toHaveText(['Our family', 'Farmyard friends', 'My little words']);
  await page.getByRole('button', { name: 'Edit Our family', exact: true }).click();
  await page.getByRole('button', { name: 'Duplicate board', exact: true }).click();
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await expect(titles).toHaveText(['Our family', 'Farmyard friends', 'My little words', 'Our family (copy)']);
  expect((await savedLibrary(page)).boardLastPlayedAt).toEqual(before.boardLastPlayedAt);
  await page.getByRole('button', { name: 'More options for Our family', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Generate missing audio (6)', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete board', exact: true }).click();
  await page.getByRole('button', { name: 'Delete board', exact: true }).click();
  await expect(page.getByTestId('recent-board').getByTestId('board-card-title')).toHaveText('Farmyard friends');
  await expect(page.getByText('Saving…', { exact: true })).toHaveCount(0);
  await page.reload();
  expect((await savedLibrary(page)).boardLastPlayedAt['starter-family']).toBeUndefined();
  await expect(titles).toHaveText(['Farmyard friends', 'My little words', 'Our family (copy)']);
  await page.getByRole('button', { name: 'Resume Farmyard friends', exact: true }).click();
  await expect(page.getByTestId('play-board')).toBeVisible();
});

test('returning from a legacy active session creates an accessible responsive spotlight', async ({ page }) => {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('little-say'); request.onsuccess = () => resolve(request.result); });
    await new Promise<void>(resolve => {
      const tx = db.transaction('state', 'readwrite'), store = tx.objectStore('state'), request = store.get('library');
      request.onsuccess = () => { const library = request.result; library.settings.activeBoardId = 'starter-family'; store.put(library, 'library'); };
      tx.oncomplete = () => resolve();
    }); db.close();
  });
  await page.reload(); await expect(page.getByTestId('play-board')).toBeVisible(); await leaveBoard(page);
  const hero = page.getByTestId('recent-board');
  await expect(hero.getByTestId('board-card-title')).toHaveText('Our family');
  await hero.getByRole('button', { name: 'Add Our family to favorites', exact: true }).click();
  await page.getByRole('button', { name: 'Add Farmyard friends to favorites', exact: true }).click();
  await mkdir('artifacts/screenshots', { recursive: true });
  for (const size of [{ width: 1180, height: 820 }, { width: 820, height: 1180 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await expect(hero).toBeInViewport({ ratio: 1 });
    for (const name of ['Play Our family', 'Edit Our family', 'More options for Our family', 'Remove Our family from favorites']) await expect(hero.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
    const featured = (await hero.boundingBox())!, regular = (await page.getByTestId('library-board').nth(1).boundingBox())!;
    expect(featured.width * featured.height).toBeGreaterThan(regular.width * regular.height * 1.2);
    expect(featured.x + featured.width).toBeLessThanOrEqual(size.width);
    await page.screenshot({ path: `artifacts/screenshots/recent-board-${size.width}.png` });
  }
  await hero.getByRole('button', { name: 'Play Our family', exact: true }).click();
  await expect(page.getByTestId('play-board')).toBeVisible();
});

test('favorites stay immediately below the latest board, with recent play order within each group', async ({ page, context }) => {
  const titles = page.getByTestId('board-card-title');
  await play(page, 'Farmyard friends'); await leaveBoard(page);
  await play(page, 'My little words'); await leaveBoard(page);
  await expect(titles).toHaveText(['My little words', 'Farmyard friends', 'Our family']);
  await page.getByRole('button', { name: 'Add Our family to favorites', exact: true }).click();
  await expect(titles).toHaveText(['My little words', 'Our family', 'Farmyard friends']);
  await expect(page.getByRole('button', { name: 'Remove Our family from favorites', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('play-board')).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove Our family from favorites', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add Our family to favorites', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(titles).toHaveText(['My little words', 'Farmyard friends', 'Our family']);
  await page.getByRole('button', { name: 'Add Our family to favorites', exact: true }).click();
  await page.getByRole('button', { name: 'Add Farmyard friends to favorites', exact: true }).click();
  await expect(titles).toHaveText(['My little words', 'Farmyard friends', 'Our family']);
  await page.getByTestId('recent-board').getByRole('button', { name: 'Add My little words to favorites', exact: true }).click();
  await expect(page.getByTestId('library-board')).toHaveCount(3);
  await page.getByRole('button', { name: 'Remove Farmyard friends from favorites', exact: true }).click();
  await expect(titles).toHaveText(['My little words', 'Our family', 'Farmyard friends']);
  await expect(page.getByText('Saving…', { exact: true })).toHaveCount(0);
  const before = await savedLibrary(page);
  expect(before.favoriteBoardIds.sort()).toEqual(['starter-everyday', 'starter-family']);
  expect(before.boards.map((board: any) => board.revision)).toEqual([0, 0, 0]);
  await page.evaluate(() => navigator.serviceWorker.ready); await context.setOffline(true); await page.reload();
  await expect(titles).toHaveText(['My little words', 'Our family', 'Farmyard friends']);
  await expect(page.getByRole('button', { name: 'Remove Our family from favorites', exact: true })).toBeVisible();
  await play(page, 'Farmyard friends'); await leaveBoard(page);
  await expect(titles).toHaveText(['Farmyard friends', 'My little words', 'Our family']);
  await expect(page.getByTestId('recent-board').getByRole('button', { name: 'Add Farmyard friends to favorites', exact: true })).toBeVisible();
  expect((await savedLibrary(page)).favoriteBoardIds.sort()).toEqual(before.favoriteBoardIds);
});

test('favorites work before first play, retry failed saves, and are independent of edits, copies and deletion', async ({ page }) => {
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: any[]) { if ((window as any).__failWrites) throw new DOMException('Storage full', 'QuotaExceededError'); return original.apply(this, args as any); };
    (window as any).__failWrites = true;
  });
  await page.getByRole('button', { name: 'Add Our family to favorites', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry saving', exact: true })).toBeVisible();
  await expect(page.getByTestId('board-card-title')).toHaveText(['Our family', 'Farmyard friends', 'My little words']);
  await expect(page.getByTestId('recent-board')).toHaveCount(0);
  await expect(page.getByTestId('play-board')).toHaveCount(0);
  await page.evaluate(() => { (window as any).__failWrites = false; });
  await page.getByRole('button', { name: 'Retry saving', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry saving', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Remove Our family from favorites', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit Our family', exact: true }).click();
  await page.getByRole('textbox', { name: 'Board title', exact: true }).fill('People');
  await page.getByRole('button', { name: 'Undo last board change', exact: true }).click();
  await page.getByRole('button', { name: 'Duplicate board', exact: true }).click();
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove Our family from favorites', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Our family (copy) to favorites', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'More options for Our family', exact: true }).click();
  await page.getByRole('button', { name: 'Delete board', exact: true }).click();
  await page.getByRole('button', { name: 'Delete board', exact: true }).click();
  await expect(page.getByText('Saving…', { exact: true })).toHaveCount(0);
  await page.reload();
  expect((await savedLibrary(page)).favoriteBoardIds).toEqual([]);
  await expect(page.getByTestId('board-card-title')).toHaveText(['Farmyard friends', 'My little words', 'Our family (copy)']);
});
