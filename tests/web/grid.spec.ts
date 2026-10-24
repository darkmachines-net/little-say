/** @file Verifies balanced play/preview rows, touch geometry through rotation, and compact-window recovery. */

import { test, expect, type Locator, type Page } from '@playwright/test';
import { starterLibrary } from '../fixtures/library';
import { openExistingLibrary } from './existingLibrary';

const viewports = [{ width: 820, height: 1180 }, { width: 1180, height: 820 }, { width: 390, height: 844 }, { width: 844, height: 390 }];
const longLabel = 'Please help me find my favourite things';

async function openBoard(page: Page, count: number, playing = true, label = longLabel) {
  await page.addInitScript(() => {
    const w = window as any;
    w.__spoken = []; w.__utterances = [];
    w.SpeechSynthesisUtterance = class {
      text: string; lang = ''; onend: any;
      /** Retain the requested words for deterministic browser speech assertions. */
      constructor(text: string) { this.text = text; }
    };
    Object.defineProperty(w, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [{ voiceURI: 'test-en', name: 'English', lang: 'en-US', localService: true, default: true }],
      speak: (utterance: any) => { w.__spoken.push(utterance.text); w.__utterances.push(utterance); },
      cancel: () => { w.__utterances = []; }, addEventListener() {}, removeEventListener() {},
    } });
    Element.prototype.requestFullscreen = async () => {};
  });
  await openExistingLibrary(page);
  const library = starterLibrary();
  library.settings.accountChoiceMade = true;
  const board = library.boards[0];
  board.title = 'My board';
  board.tiles = Array.from({ length: count }, (_, i) => ({ ...board.tiles[i % 6], id: `tile-${i}`, label: i === count - 1 ? label : `Word ${i + 1}`, speech: `Word ${i + 1}` }));
  library.boards = [board];
  library.settings.accountChoiceMade = true;
  library.settings.activeBoardId = playing ? board.id : null;
  await page.evaluate(async data => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('little-say'); request.onsuccess = () => resolve(request.result); });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put(data, 'library');
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    }); db.close();
  }, library);
  await page.reload();
  if (playing) await expect(page.getByTestId('touch-surface')).toBeVisible();
  else await page.getByRole('button', { name: 'Edit My board', exact: true }).click();
}

async function rowsOf(buttons: Locator) {
  const bounds = await buttons.evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }));
  const rows: typeof bounds[] = [];
  for (const rect of bounds) {
    const row = rows.find(items => Math.abs(items[0].y - rect.y) < 1);
    if (row) row.push(rect); else rows.push([rect]);
  }
  return rows;
}

for (const count of [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 23, 24]) {
  test(`${count} cards fill balanced rows across tablet and phone rotation`, async ({ page }) => {
    await openBoard(page, count);
    const surface = page.getByTestId('touch-surface');
    const buttons = surface.getByRole('button');
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await expect(async () => {
        await expect(buttons).toHaveCount(count);
        const rows = await rowsOf(buttons), bounds = (await surface.boundingBox())!;
        const counts = rows.map(row => row.length);
        expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
        if (count === 4 && viewport.width >= 820 && viewport.height >= 820) expect(counts).toEqual([2, 2]);
        for (const row of rows) {
          expect(Math.abs(row[0].x - bounds.x)).toBeLessThan(1);
          expect(Math.abs(row.at(-1)!.x + row.at(-1)!.width - bounds.x - bounds.width)).toBeLessThan(1);
          for (const rect of row) {
            expect(Math.min(rect.width, rect.height)).toBeGreaterThanOrEqual(44);
            expect(rect.y).toBeGreaterThanOrEqual(bounds.y - 1);
            expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height);
          }
        }
      }).toPass();
      await expect(buttons.last()).toHaveAccessibleName(longLabel);
    }
    await buttons.last().focus(); await page.keyboard.press('Enter');
    expect(await page.evaluate(() => (window as any).__spoken)).toEqual([`Word ${count}`]);
  });
}

test('rotation preserves speech and cancels contacts measured against the old grid', async ({ page }) => {
  await page.setViewportSize(viewports[0]); await openBoard(page, 5);
  const buttons = page.getByTestId('touch-surface').getByRole('button');
  await buttons.nth(0).click(); await buttons.nth(1).click();
  await page.setViewportSize(viewports[1]);
  await expect(page.getByTestId('tile-playing')).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__spoken)).toEqual(['Word 1']);
  await page.evaluate(() => (window as any).__utterances.shift().onend());
  await expect.poll(() => page.evaluate(() => (window as any).__spoken)).toEqual(['Word 1', 'Word 2']);
  await page.evaluate(() => (window as any).__utterances.shift().onend());
  await expect(page.getByTestId('tile-playing')).toHaveCount(0);

  const first = (await buttons.nth(0).boundingBox())!;
  await page.mouse.move(first.x + first.width + 6, first.y + first.height / 2); await page.mouse.down();
  await page.setViewportSize(viewports[0]);
  await expect(async () => { expect((await rowsOf(buttons)).length).toBeGreaterThan(2); }).toPass();
  const last = (await buttons.last().boundingBox())!;
  await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2); await page.mouse.up();
  expect(await page.evaluate(() => (window as any).__spoken)).toEqual(['Word 1', 'Word 2']);
  await buttons.last().click();
  expect(await page.evaluate(() => (window as any).__spoken)).toEqual(['Word 1', 'Word 2', 'Word 5']);

  const control = page.getByTestId('parent-control');
  const hold = (await control.boundingBox())!;
  await page.mouse.move(hold.x + hold.width / 2, hold.y + hold.height / 2); await page.mouse.down();
  await page.setViewportSize(viewports[1]);
  await expect(control).toHaveText('Hold to unlock'); await page.mouse.up();
  await expect(page.getByRole('heading', { name: 'Leave this board?' })).toHaveCount(0);
});

for (const [language, label] of [['English', longLabel], ['Russian', 'Помоги мне найти любимые вещи'], ['Spanish', 'Ayúdame a encontrar mis cosas favoritas']]) {
  test(`dense phone cards retain whole pictures and long ${language} accessible names`, async ({ page }) => {
    await page.setViewportSize(viewports[2]);
    await openBoard(page, 24, true, label);
    const card = page.getByTestId('touch-surface').getByRole('button').last();
    await expect(card).toHaveAccessibleName(label);
    await expect(async () => {
      const picture = card.getByTestId('tile-picture');
      const frame = (await picture.boundingBox())!;
      const emoji = (await picture.locator(':scope > *').boundingBox())!;
      expect(frame.height).toBeGreaterThanOrEqual(20);
      expect(emoji.height).toBeLessThanOrEqual(frame.height + 1);
      expect(emoji.y).toBeGreaterThanOrEqual(frame.y - 1);
      expect(emoji.y + emoji.height).toBeLessThanOrEqual(frame.y + frame.height + 1);
    }).toPass();
    await card.focus(); await page.keyboard.press('Enter');
    expect(await page.evaluate(() => (window as any).__spoken)).toEqual(['Word 24']);
  });
}

for (const count of [7, 24]) {
  test(`${count}-card editor preview remains balanced and editable`, async ({ page }) => {
    await openBoard(page, count, false);
    const buttons = page.getByTestId('editor-preview').getByRole('button');
    for (const viewport of [viewports[0], viewports[1], { width: 1024, height: 768 }]) {
      await page.setViewportSize(viewport);
      await expect(async () => {
        const counts = (await rowsOf(buttons)).map(row => row.length);
        expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
        for (const button of await buttons.all()) await expect(button).toBeInViewport({ ratio: 1 });
      }).toPass();
      for (const name of ['Edit with AI', 'Duplicate board', 'Delete board', 'Languages', 'Play board']) {
        await expect(page.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
      }
    }
    await buttons.last().click();
    await expect(page.getByRole('textbox', { name: 'Words on the tile', exact: true })).toHaveValue(longLabel);
  });
}

test('a tiny play window explains its limit and recovers on resize', async ({ page }) => {
  await openBoard(page, 24);
  await page.setViewportSize({ width: 320, height: 320 });
  await expect(page.getByText('More room is needed for this board.', { exact: false })).toBeVisible();
  await expect(page.getByTestId('touch-surface')).toHaveCount(0);
  await page.setViewportSize(viewports[1]);
  await expect(page.getByTestId('touch-surface').getByRole('button')).toHaveCount(24);
  await page.getByRole('button', { name: longLabel, exact: true }).click();
  expect(await page.evaluate(() => (window as any).__spoken)).toEqual(['Word 24']);
});
