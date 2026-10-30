/** @file Verifies asynchronous play entry, headers, unlock timing, draft recovery, motion and explicit device-speech handoff. */

import { mkdir } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import { openExistingLibrary } from './existingLibrary';

async function play(page: Page) {
  await page.getByRole('button', { name: 'Play Farmyard friends', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cow', exact: true })).toBeVisible();
}
async function unlock(page: Page) {
  await expect(page.getByTestId('play-board')).toBeVisible();
  if (await page.getByTestId('board-lock').isVisible()) await page.getByTestId('board-lock').click();
  const control = page.getByTestId('parent-control'), box = (await control.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await expect(page.getByTestId('board-back')).toBeVisible(); await page.mouse.up();
  await expect(page.getByTestId('play-board')).toBeVisible();
  await page.getByTestId('board-back').click();
  await expect(page.getByRole('heading', { name: 'Edit board', exact: true })).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any; w.__spoken = []; w.__allSpeech = []; w.__stops = 0;
    w.SpeechSynthesisUtterance = class {
      /** Retain the requested words for deterministic browser speech assertions. */
      constructor(public text: string) {}
    };
    Object.defineProperty(w, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [{ voiceURI: 'test-en', name: 'English', lang: 'en-US', localService: true }],
      speak: (utterance: any) => { w.__spoken.push(utterance.text); w.__allSpeech.push(utterance); },
      cancel: () => { w.__stops++; }, addEventListener() {}, removeEventListener() {},
    } });
    Element.prototype.requestFullscreen = async () => {};
  });
  await openExistingLibrary(page, { voiceSources: { 'en-US': 'device', 'ru-RU': 'device', 'fr-FR': 'device' } });
});

test('dashboard and reload entry bind the same board, preserve edits and stop active/pending audio', async ({ page }) => {
  await play(page); await page.reload(); await expect(page.getByTestId('play-board')).toBeVisible();
  await page.getByRole('button', { name: 'Cow', exact: true }).click();
  await page.getByRole('button', { name: 'Sheep', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__spoken)).toEqual(['Cow']);
  await unlock(page);
  await expect(page.getByRole('textbox', { name: 'Board title', exact: true })).toHaveValue('Farmyard friends');
  await expect(page.getByRole('heading', { name: 'Edit board', exact: true })).toBeFocused();
  await expect(page.getByText('Leave this board?')).toHaveCount(0);
  await page.evaluate(() => (window as any).__allSpeech[0].onend?.());
  expect(await page.evaluate(() => (window as any).__spoken)).toEqual(['Cow']);
  await page.getByRole('textbox', { name: 'Board title', exact: true }).fill('Our farm');
  await page.getByRole('button', { name: 'Return to play', exact: true }).click();
  await expect(page.getByTestId('play-board')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Our farm', exact: true })).toBeFocused();
  await expect(page.getByTestId('tile-playing')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__spoken)).toEqual(['Cow']);
  await page.getByRole('button', { name: 'Sheep', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__spoken)).toEqual(['Cow', 'Sheep']);
  await unlock(page);
  await page.getByRole('button', { name: 'Undo last board change', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Board title', exact: true })).toHaveValue('Farmyard friends');
});

test('selected play language, missing translations and voice safeguards survive the direct handoff', async ({ page }) => {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('little-say'); request.onsuccess = () => resolve(request.result); });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite'), store = tx.objectStore('state'), request = store.get('library');
      request.onsuccess = () => {
        const library = request.result, board = library.boards[0];
        board.playLanguages = ['en-US', 'fr-FR']; board.tiles.forEach((tile: any) => { tile.languageMode = 'board'; });
        board.tiles[0].translations = [{ label: 'Vache', speech: 'Vache', language: 'fr-FR', source: JSON.stringify(['Cow', 'Cow', 'en-US']) }];
        library.settings.activeBoardId = board.id; library.settings.boardLanguages = { [board.id]: 'fr-FR' };
        (window as any).__expectedBoard = board; store.put(library, 'library');
      };
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    }); db.close();
  });
  const original = await page.evaluate(() => (window as any).__expectedBoard);
  await page.reload(); await expect(page.getByTestId('play-board')).toBeVisible(); await unlock(page);
  await expect(page.getByText('5 switchable cards still use their original words.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Return to play', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A quick sound check', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close A quick sound check', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit board', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Return to play', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to board', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Vache', exact: true })).toBeVisible();
  const saved = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('little-say'); request.onsuccess = () => resolve(request.result); });
    const library = await new Promise<any>(resolve => { const request = db.transaction('state').objectStore('state').get('library'); request.onsuccess = () => resolve(request.result); }); db.close(); return library;
  });
  expect(saved.boards[0]).toEqual(original);
  expect(saved.settings.boardLanguages[original.id]).toBe('fr-FR'); expect(saved.settings.aiConsent).toBe(false);
  expect(await page.evaluate(() => (window as any).__spoken)).toEqual([]);
});

test('keyboard requires a continuous hold and cancels repeat, blur, Escape and background interruptions', async ({ page }) => {
  await play(page); if (await page.getByTestId('board-lock').isVisible()) await page.getByTestId('board-lock').click();
  const control = page.getByTestId('parent-control');
  await page.clock.install({ time: new Date('2026-10-07T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-07T00:00:01Z'));
  await control.focus(); await page.keyboard.down('Space'); await page.clock.runFor(999); await page.keyboard.up('Space');
  await expect(page.getByTestId('play-board')).toBeVisible(); await expect(page.getByTestId('board-lock-status')).toHaveText('Locked · hold 1 s to unlock');
  for (const reason of ['Escape', 'blur', 'hidden']) {
    await control.focus(); await page.keyboard.down('Enter'); await page.clock.runFor(500);
    if (reason === 'Escape') await page.keyboard.press('Escape');
    else if (reason === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    else await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.clock.runFor(1000); await page.keyboard.up('Enter');
    await expect(page.getByTestId('board-lock-status')).toHaveText('Locked · hold 1 s to unlock');
    if (reason === 'hidden') await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); });
  }
  await control.focus(); await page.keyboard.down('Enter'); await page.clock.runFor(500); await page.keyboard.down('Enter');
  await page.clock.runFor(500); await expect(page.getByTestId('board-back')).toBeVisible(); await page.keyboard.up('Enter');
  await page.getByTestId('board-back').click();
  await page.clock.runFor(800); await expect(page.getByRole('heading', { name: 'Edit board', exact: true })).toBeVisible();
});

test('assistive activation is delayed, cancellable and cannot fire after backgrounding', async ({ page }) => {
  await play(page); if (await page.getByTestId('board-lock').isVisible()) await page.getByTestId('board-lock').click();
  const control = page.getByTestId('parent-control');
  await page.clock.install({ time: new Date('2026-10-07T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-07T00:00:01Z'));
  const activate = () => control.evaluate(element => (element as HTMLButtonElement).click());
  await activate(); await page.clock.runFor(999); await expect(page.getByTestId('play-board')).toBeVisible();
  await activate(); await page.clock.runFor(500); await expect(page.getByTestId('board-lock-status')).toHaveText('Locked · hold 1 s to unlock');
  await activate(); await page.clock.runFor(500); await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.clock.runFor(1000); await expect(page.getByTestId('board-lock-status')).toHaveText('Locked · hold 1 s to unlock');
  await activate(); await page.clock.runFor(1000);
  await expect(page.getByTestId('play-board')).toBeVisible();
  await page.getByTestId('board-back').click(); await page.clock.runFor(800);
  await expect(page.getByRole('heading', { name: 'Edit board', exact: true })).toBeVisible();
});

test('leaving the control or a second contact before completion cancels unlock', async ({ page, context }) => {
  await play(page); if (await page.getByTestId('board-lock').isVisible()) await page.getByTestId('board-lock').click();
  const control = page.getByTestId('parent-control');
  await page.clock.install({ time: new Date('2026-10-07T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-07T00:00:01Z'));
  const box = (await control.boundingBox())!;
  await page.mouse.move(box.x + box.width - 2, box.y + 20); await page.mouse.down(); await page.clock.runFor(500);
  await page.mouse.move(box.x + box.width + 2, box.y + 20); await page.mouse.up();
  await expect(page.getByTestId('board-lock-status')).toHaveText('Locked · hold 1 s to unlock');
  const session = await context.newCDPSession(page);
  const first = { id: 1, x: Math.round(box.x + 25), y: Math.round(box.y + 20) };
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
  await page.clock.runFor(500);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first, { id: 2, x: 40, y: 40 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.clock.runFor(1000); await expect(page.getByTestId('board-back')).toHaveCount(0); await expect(page.getByTestId('play-board')).toBeVisible();
});

test('a pending return keeps the editor visible and prevents concurrent edits until the save completes', async ({ page }) => {
  await play(page); await unlock(page);
  await page.getByRole('textbox', { name: 'Board title', exact: true }).fill('Saved before play');
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const original = IDBTransaction.prototype.addEventListener;
    const completions: (() => void)[] = [];
    (window as any).__finishWrites = () => { IDBTransaction.prototype.addEventListener = original; completions.splice(0).forEach(complete => complete()); };
    IDBTransaction.prototype.addEventListener = function (type: string, listener: any, options?: any) {
      const wrapped = type === 'complete' && this.mode === 'readwrite' && this.objectStoreNames.contains('state')
        ? (event: Event) => completions.push(() => typeof listener === 'function' ? listener.call(this, event) : listener.handleEvent(event)) : listener;
      return original.call(this, type, wrapped, options);
    };
  });
  await page.getByRole('button', { name: 'Return to play', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit board', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Board title', exact: true })).not.toBeEditable();
  for (const name of ['Boards', 'Edit tile Cow', 'Edit with AI', 'Languages']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
  await page.evaluate(() => (window as any).__finishWrites());
  await expect(page.getByRole('heading', { name: 'Saved before play', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__spoken)).toEqual([]);
});

test('a failed save retains edits and editor until retry without requesting board or picture AI', async ({ page }) => {
  let aiRequests = 0; page.on('request', request => { if (/\/api\/(boards\/propose|pictures|translat)/.test(request.url())) aiRequests++; });
  await play(page); await unlock(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as any).__restoreWrites = () => { IDBObjectStore.prototype.put = original; };
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) { if (this.name === 'state') throw new DOMException('Fixture storage full', 'QuotaExceededError'); return original.apply(this, args); };
  });
  await page.getByRole('textbox', { name: 'Board title', exact: true }).fill('Keep my changes');
  await expect(page.getByRole('button', { name: 'Retry saving', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Return to play', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit board', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Board title', exact: true })).toHaveValue('Keep my changes');
  await page.evaluate(() => (window as any).__restoreWrites());
  await page.getByRole('button', { name: 'Retry saving', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry saving', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Return to play', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Keep my changes', exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByRole('heading', { name: 'Keep my changes', exact: true })).toBeVisible();
  expect(aiRequests).toBe(0);
});

for (const viewport of [{ width: 1180, height: 820 }, { width: 820, height: 1180 }, { width: 844, height: 390 }, { width: 390, height: 844 }]) {
  test(`existing editing controls and drafts remain usable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport); await play(page); await unlock(page);
    const preview = await page.getByTestId('editor-preview').boundingBox(), actions = await page.getByTestId('editor-actions').boundingBox();
    if (viewport.width >= 900) expect(preview!.x + preview!.width).toBeLessThanOrEqual(actions!.x);
    else expect(preview!.y + preview!.height).toBeLessThanOrEqual(actions!.y);
    await page.getByRole('button', { name: 'Edit tile Cow', exact: true }).click();
    await page.getByRole('textbox', { name: 'Words on the tile', exact: true }).fill('Unsaved calf');
    await expect(page.getByRole('button', { name: 'Return to play', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Close Edit tile', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Edit tile Cow', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Edit with AI', exact: true }).click();
    await expect(page.getByTestId('ai-conversation')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Return to play', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Back to board', exact: true }).click();
    await page.getByRole('button', { name: 'Languages', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Board languages', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close Board languages', exact: true }).click();
    await page.getByRole('button', { name: 'Return to play', exact: true }).click();
    await expect(page.getByTestId('play-board')).toBeVisible();
  });
}

test('cards shrink toward the measured preview while existing controls are already available', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 }); await play(page);
  await page.clock.install({ time: new Date('2026-10-07T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-07T00:00:01Z'));
  const source = (await page.getByRole('button', { name: 'Cow', exact: true }).boundingBox())!;
  if (await page.getByTestId('board-lock').isVisible()) await page.getByTestId('board-lock').click();
  const control = (await page.getByTestId('parent-control').boundingBox())!;
  await page.mouse.move(control.x + 20, control.y + 20); await page.mouse.down();
  await page.clock.runFor(1000); await page.mouse.up(); await page.getByTestId('board-back').click(); await page.clock.runFor(1);
  await expect(page.getByRole('button', { name: 'Edit with AI', exact: true })).toBeEnabled();
  const overlay = page.getByTestId('board-transition'); await expect(overlay).toHaveAttribute('aria-hidden', 'true');
  // ResizeObserver measurements are delivered between browser tasks, separately from the fake clock.
  await expect(async () => { await page.clock.runFor(16); expect(await overlay.locator(':scope > div').count()).toBe(6); }).toPass({ timeout: 1500, intervals: [16] });
  await page.clock.runFor(80);
  const frame = (await overlay.locator(':scope > div').first().boundingBox())!;
  const target = (await page.getByRole('button', { name: 'Edit tile Cow', exact: true }).boundingBox())!;
  expect(frame.width).toBeLessThan(source.width); expect(frame.width).toBeGreaterThan(target.width);
  expect(Math.abs(frame.x - target.x)).toBeLessThan(Math.abs(source.x - target.x));
  await page.clock.runFor(800); await expect(overlay).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit tile Cow', exact: true })).toBeVisible();
});

test('reduced motion and resize during the transition always leave a usable editor', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await play(page); await unlock(page);
  await expect(page.getByTestId('board-transition')).toHaveCount(0);
  await page.getByRole('button', { name: 'Return to play', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await unlock(page); await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('board-transition')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit tile Cow', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit tile', exact: true })).toBeVisible();
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1180, height: 820 }]) {
  test('boards open unlocked, lock in one tap, and require unlock then back to leave at ' + viewport.width + 'px', async ({ page }) => {
    await page.setViewportSize(viewport);
    await play(page);
    const captures = 'artifacts/screenshots/board-navigation';
    await mkdir(captures, { recursive: true });
    const back = page.getByRole('button', { name: 'Back to editor', exact: true });
    const lock = page.getByRole('button', { name: 'Lock board', exact: true });
    await expect(back).toBeVisible();
    await expect(lock).toBeVisible();
    expect((await back.boundingBox())!.x).toBeLessThan((await lock.boundingBox())!.x);
    await expect(page.getByTestId('parent-control')).toHaveCount(0);
    const title = page.getByTestId('board-title'), grid = page.getByTestId('touch-surface');
    const titleBox = await title.boundingBox(), gridBox = await grid.boundingBox(), lockBox = await lock.boundingBox();
    await page.screenshot({ path: captures + '/after-unlocked-' + viewport.width + '.png' });
    await lock.click();
    await expect(back).toHaveCount(0);
    const control = page.getByTestId('parent-control');
    await expect(page.getByTestId('board-lock-status')).toHaveText('Locked · hold 1 s to unlock');
    expect(await title.boundingBox()).toEqual(titleBox); expect(await grid.boundingBox()).toEqual(gridBox);
    expect(await control.boundingBox()).toEqual(lockBox);
    await page.screenshot({ path: captures + '/after-locked-' + viewport.width + '.png' });
    await control.click();
    await expect(back).toHaveCount(0);
    await page.clock.install({ time: new Date('2026-10-25T12:00:00Z') });
    await page.clock.pauseAt(new Date('2026-10-25T12:00:01Z'));
    await control.focus(); await page.keyboard.down('Enter'); await page.clock.runFor(500);
    await expect(page.getByTestId('board-lock-status')).toHaveText('Unlocking…');
    const progress = Number(await page.getByRole('progressbar', { name: 'Unlock progress' }).getAttribute('aria-valuenow'));
    expect(progress).toBeGreaterThanOrEqual(48); expect(progress).toBeLessThanOrEqual(50);
    await page.screenshot({ path: captures + '/after-holding-' + viewport.width + '.png' });
    await page.clock.runFor(499); await expect(back).toHaveCount(0);
    await page.clock.runFor(1); await expect(back).toBeVisible();
    await page.keyboard.up('Enter'); await expect(back).toBeVisible();
    expect(await title.boundingBox()).toEqual(titleBox); expect(await grid.boundingBox()).toEqual(gridBox);
    expect(await lock.boundingBox()).toEqual(lockBox);
    await expect(back).toBeVisible();
    await expect(page.getByTestId('play-board')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.screenshot({ path: captures + '/after-unlocked-again-' + viewport.width + '.png' });
    await page.getByRole('button', { name: 'Cow', exact: true }).click();
    expect(await page.evaluate(() => (window as any).__spoken)).toEqual(['Cow']);
    await lock.click(); await expect(back).toHaveCount(0);
    await page.clock.resume();
    await page.reload(); await expect(back).toBeVisible();
    await back.click();
    await expect(page.getByRole('heading', { name: 'Edit board', exact: true })).toBeVisible();
  });
}
