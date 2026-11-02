/** @file Verifies stable refresh and Settings controls, responsive creation, floating-action clearance, and draft resumption. */

import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { openExistingLibrary } from './existingLibrary';

test('manual refresh shows navbar progress without moving boards or header actions', async ({ page }) => {
  await openExistingLibrary(page);
  const header = page.getByTestId('app-header');
  const refresh = header.getByRole('button', { name: 'Refresh content', exact: true });
  await expect(refresh).toBeEnabled();
  // Finish the startup backup before installing the deliberately delayed refresh response.
  await refresh.click();
  await expect(refresh).toBeEnabled();
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(async () => (await page.getByTestId('app-header-bar').boundingBox())?.height).toBe(width < 600 ? 64 : 76);
    const elements = [header, refresh, header.getByRole('button', { name: 'Settings', exact: true }), page.getByTestId('library-board').first(), page.getByRole('button', { name: 'New board', exact: true })];
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/account/backup', async route => { await ready; await route.continue(); });
    const before = await Promise.all(elements.map(element => element.boundingBox()));
    try {
      await refresh.click();
      await expect(refresh.getByRole('progressbar')).toBeVisible();
      await expect(refresh).toBeDisabled();
      await expect(page.getByText('Syncing your content…', { exact: true })).toHaveCount(0);
      await expect(page.getByTestId('dashboard-scroll').getByRole('progressbar')).toHaveCount(0);
      expect(await Promise.all(elements.map(element => element.boundingBox()))).toEqual(before);
      for (const action of await header.getByRole('button').all()) await expect(action).toBeInViewport({ ratio: 1 });
      if (width === 320) await page.screenshot({ path: test.info().outputPath('sync-navbar-phone.png') });
    } finally { release(); }
    await expect(refresh).toBeEnabled();
    expect(await Promise.all(elements.map(element => element.boundingBox()))).toEqual(before);
    await page.unroute('**/api/account/backup');
  }
});

test('phone creation scrolls with boards while wider actions stay fixed and leave the final row reachable', async ({ page, context }) => {
  await openExistingLibrary(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('little-say'); request.onsuccess = () => resolve(request.result); });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite'), store = tx.objectStore('state'), request = store.get('library');
      request.onsuccess = () => {
        const library = request.result, originals = library.boards;
        library.boards = Array.from({ length: 12 }, (_, index) => {
          const board = originals[index % originals.length];
          return { ...board, id: `${board.id}-${index}`, title: `${board.title} ${index + 1}`, tiles: board.tiles.map((tile: any) => ({ ...tile, id: `${tile.id}-${index}` })) };
        });
        store.put(library, 'library');
      };
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  const scroll = page.getByTestId('dashboard-scroll');
  const action = page.getByRole('button', { name: 'New board', exact: true });
  const cards = page.getByTestId('library-board');
  const device = await context.newCDPSession(page);
  await expect(cards).toHaveCount(12);
  await mkdir('artifacts/screenshots/dashboard', { recursive: true });

  for (const viewport of [{ width: 390, height: 844 }, { width: 620, height: 800 }, { width: 621, height: 800 }, { width: 820, height: 900 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(viewport);
    const insets = viewport.width === 820 ? { top: 24, right: 36, bottom: 44, left: 36 } : { top: 0, right: 0, bottom: 0, left: 0 };
    await device.send('Emulation.setSafeAreaInsetsOverride', { insets });
    await scroll.evaluate(element => { element.scrollTop = 0; });
    await expect(action).toHaveCount(1);
    await expect(action).toBeInViewport({ ratio: 1 });
    await expect(scroll.getByRole('button', { name: 'New board', exact: true })).toHaveCount(viewport.width <= 620 ? 1 : 0);
    const before = (await action.boundingBox())!;
    const first = (await cards.first().boundingBox())!;
    if (viewport.width <= 620) {
      expect(before.x).toBeCloseTo(first.x, 0);
      expect(before.width).toBeCloseTo(first.width, 0);
      expect(before.y + before.height).toBeLessThan(first.y);
    } else {
      expect(before.x).toBeGreaterThan(viewport.width / 2);
      expect(before.x + before.width).toBeLessThanOrEqual(viewport.width - insets.right);
      expect(before.y + before.height).toBeLessThanOrEqual(viewport.height - insets.bottom);
      expect(before.y).toBeGreaterThan(viewport.height / 2);
    }
    await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    if (viewport.width <= 620) {
      await expect(action).not.toBeInViewport();
    } else {
      await expect.poll(async () => {
        const last = (await cards.last().boundingBox())!, floating = (await action.boundingBox())!;
        return floating.y - last.y - last.height;
      }).toBeGreaterThanOrEqual(15);
      expect((await action.boundingBox())!.y).toBeCloseTo(before.y, 0);
      for (const control of await cards.last().getByRole('button').all()) await expect(control).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: `artifacts/screenshots/dashboard/fab-clearance-${viewport.width}.png` });
    }
  }
});

test('the floating action resumes saved drafts and becomes inline again on phones', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openExistingLibrary(page);
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill('Animal friends');
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  const resume = page.getByRole('button', { name: 'Resume draft', exact: true });
  for (const width of [1280, 390, 621]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(resume).toHaveCount(1);
    await expect(resume).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('dashboard-scroll').getByRole('button', { name: 'Resume draft', exact: true })).toHaveCount(width <= 620 ? 1 : 0);
  }
  await resume.click();
  await expect(page.getByRole('textbox', { name: 'Message to AI', exact: true })).toHaveValue('Animal friends');
});
