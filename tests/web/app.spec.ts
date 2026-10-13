/**
 * @file Exercises board editing and play, safe modal dismissal, navigation protection, responsive
 * layouts, and offline browser behavior.
 */

import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pcmToWav } from '../../apps/server/src/synthesis';
import { openExistingLibrary } from './existingLibrary';

async function setupSpeech(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.__spoken = []; w.__utterances = [];
    w.SpeechSynthesisUtterance = class { text = ''; lang = ''; voice = null; onend: any; onerror: any; onstart: any; constructor(text = '') { this.text = text; } };
    Object.defineProperty(w, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [{ voiceURI: 'test-en', name: 'English test voice', lang: 'en-US', localService: true, default: true }, { voiceURI: 'test-ru', name: 'Russian test voice', lang: 'ru-RU', localService: true, default: false }, { voiceURI: 'test-es', name: 'Spanish test voice', lang: 'es-ES', localService: true }, { voiceURI: 'test-fr', name: 'French test voice', lang: 'fr-FR', localService: true }],
      speak: (utterance: any) => { w.__spoken.push({ text: utterance.text, lang: utterance.lang }); w.__utterances.push(utterance); utterance.onstart?.({}); },
      cancel: () => { w.__utterances = []; }, addEventListener() {}, removeEventListener() {},
    } });
    Element.prototype.requestFullscreen = async () => {};
  });
}
async function finishSpeech(page: Page) { await page.evaluate(() => (window as any).__utterances.shift()?.onend?.({})); }
async function leaveBoard(page: Page) {
  const control = page.getByTestId('parent-control'); const bounds = (await control.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down();
  await expect(control).toHaveText('Release to edit', { timeout: 3500 }); await page.mouse.up();
  await expect(page.getByRole('heading', { name: 'Edit board', exact: true })).toBeVisible();
}
test.beforeEach(async ({ page }) => { await setupSpeech(page); await openExistingLibrary(page); });

test.describe('outside modal dismissal', () => {
  test.use({ hasTouch: true });
  async function capture(page: Page, name: string, width: number) {
    const directory = 'artifacts/screenshots/modal-outside-dismiss';
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: `${directory}/${name}-${width}.png`, animations: 'disabled' });
  }
  for (const viewport of [{ width: 390, height: 700 }, { width: 1180, height: 900 }]) {
    test(`hold opens editing directly and return remains idle at ${viewport.width}px`, async ({ page, context }) => {
      await page.setViewportSize(viewport);
      await page.getByRole('button', { name: 'Play Farmyard friends', exact: true }).click();
      const session = await context.newCDPSession(page);
      for (let attempt = 0; attempt < 2; attempt++) {
        const control = page.getByTestId('parent-control'); const bounds = (await control.boundingBox())!;
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, id: 1 }] });
        await expect(control).toHaveText('Release to edit', { timeout: 3500 });
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect(page.getByRole('heading', { name: 'Edit board', exact: true })).toBeVisible();
        await expect(page.getByText('Leave this board?')).toHaveCount(0);
        await page.getByRole('button', { name: 'Return to play', exact: true }).click();
        await expect(page.getByTestId('play-board')).toBeVisible();
        expect(await page.evaluate(() => (window as any).__spoken)).toEqual([]);
      }
      await page.getByRole('button', { name: 'Cow', exact: true }).tap();
      expect(await page.evaluate(() => (window as any).__spoken.map((s: any) => s.text))).toEqual(['Cow']);
      await leaveBoard(page); await page.getByRole('button', { name: 'Boards', exact: true }).click();
      await expect(page.getByText('Your soundboards', { exact: true })).toBeVisible();
    });

    test(`outside taps cancel editing and deletion at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
      await page.getByRole('button', { name: 'Edit tile Cow', exact: true }).click();
      await page.getByRole('heading', { name: 'Edit tile', exact: true }).tap();
      const label = page.getByRole('textbox', { name: 'Words on the tile', exact: true });
      await label.tap();
      await label.fill('Unsaved change');
      await capture(page, 'tile-dialog', viewport.width);
      await page.getByTestId('modal-backdrop').tap({ position: { x: 4, y: 4 } });
      await expect(label).toHaveCount(0);
      await capture(page, 'tile-dismissed', viewport.width);
      await page.getByRole('button', { name: 'Edit tile Cow', exact: true }).click();
      await expect(label).toHaveValue('Cow');
      await page.getByRole('button', { name: 'Close Edit tile', exact: true }).click();

      await page.getByRole('button', { name: 'Delete board', exact: true }).click();
      await page.getByRole('heading', { name: 'Delete Farmyard friends?', exact: true }).tap();
      await page.getByTestId('modal-backdrop').tap({ position: { x: 4, y: 4 } });
      await expect(page.getByRole('heading', { name: 'Delete Farmyard friends?', exact: true })).toHaveCount(0);
      await expect(page.getByRole('textbox', { name: 'Board title', exact: true })).toHaveValue('Farmyard friends');

      await page.getByRole('button', { name: 'Edit with AI', exact: true }).click();
      await page.getByRole('heading', { name: 'Edit with AI', exact: true }).tap();
      await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill('An unsent edit');
      await capture(page, 'ai-workspace', viewport.width);
      await page.getByRole('button', { name: 'Back to board', exact: true }).tap();
      await expect(page.getByTestId('ai-conversation')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Edit tile Cow', exact: true })).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Board title', exact: true })).toHaveValue('Farmyard friends');
      await capture(page, 'ai-dismissed', viewport.width);
    });
  }
});

test('device language profile persists offline and drives French/Spanish board setup without changing fixed cards', async ({ page, context }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Languages', exact: true }).click();
  await page.getByRole('button', { name: 'More languages', exact: true }).click();
  await page.getByRole('button', { name: 'Add device language Spanish', exact: true }).click();
  await page.getByRole('button', { name: 'Add device language French', exact: true }).click();
  await page.getByRole('button', { name: 'Default language French', exact: true }).click();
  await page.getByRole('button', { name: 'Remove device language English', exact: true }).click();
  await page.getByRole('button', { name: 'Fewer languages', exact: true }).click();
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.screenshot({ path: 'artifacts/screenshots/device-languages.png' });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save settings', exact: true })).toHaveCount(0);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await context.setOffline(true); await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Languages', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove device language French', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove device language Spanish', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Default language French', exact: true })).toHaveText('✓ French');
  await expect(page.getByRole('button', { name: 'Remove device language Russian', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await context.setOffline(false);
  const words: Record<string, [string, string]> = { Cow: ['Vache', 'Vaca'], Sheep: ['Mouton', 'Oveja'], Horse: ['Cheval', 'Caballo'], Pig: ['Cochon', 'Cerdo'], Chicken: ['Poulet', 'Pollo'], Duck: ['Canard', 'Pato'] };
  await page.route('**/api/speech', route => route.fulfill({ status: 503, json: { error: 'Test device voice fallback' } }));
  await page.route('**/api/boards/translate', route => {
    const input = route.request().postDataJSON();
    expect(input.tiles.every((tile: any) => JSON.stringify(tile.targets) === JSON.stringify(['fr-FR', 'es-ES']))).toBe(true);
    return route.fulfill({ json: { boardId: input.boardId, baseRevision: input.baseRevision, translations: input.tiles.flatMap((tile: any) => tile.targets.map((language: string) => ({ tileId: tile.id, language, label: words[tile.label][language === 'fr-FR' ? 0 : 1], speech: words[tile.label][language === 'fr-FR' ? 0 : 1] }))) } });
  });
  await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
  await page.getByRole('button', { name: 'Languages', exact: true }).click();
  await expect(page.getByRole('button', { name: 'English + Russian', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'French + Spanish', exact: true }).click();
  await page.getByRole('button', { name: 'Use these languages', exact: true }).click();
  await page.getByRole('button', { name: 'Play board', exact: true }).click();
  await page.getByRole('button', { name: 'Vache', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__spoken.at(-1))).toEqual({ text: 'Vache', lang: 'fr-FR' });
  await page.getByRole('button', { name: 'Play in Spanish', exact: true }).click();
  await page.getByRole('button', { name: 'Vaca', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__spoken.at(-1))).toEqual({ text: 'Vaca', lang: 'es-ES' });
  await leaveBoard(page);
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Languages', exact: true }).click();
  await page.getByRole('button', { name: 'Remove device language French', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Default language Spanish', exact: true })).toHaveText('✓ Spanish');
  await page.getByRole('button', { name: 'Remove device language Spanish', exact: true }).click();
  await expect(page.getByText('Keep at least one language.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await page.getByRole('button', { name: 'Play Farmyard friends', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play in French', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vaca', exact: true })).toBeVisible();
  await leaveBoard(page);
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await page.getByRole('button', { name: 'Play Our family', exact: true }).click();
  await page.getByRole('button', { name: 'Babushka', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__spoken.at(-1))).toEqual({ text: 'бабушка', lang: 'ru-RU' });
});

test('regional language preferences drive manual cards and AI requests', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Languages', exact: true }).click();
  await page.getByRole('button', { name: 'More languages', exact: true }).click();
  await page.getByRole('textbox', { name: 'Another device language tag', exact: true }).fill('es-mx');
  await page.getByRole('button', { name: 'Add language', exact: true }).click();
  await page.getByRole('button', { name: 'Add device language Spanish', exact: true }).click();
  await page.getByRole('button', { name: 'Remove device language English', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save settings', exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Build manually', exact: true }).click();
  await page.setViewportSize({ width: 540, height: 820 });
  await page.getByRole('button', { name: 'Play board', exact: true }).click();
  // Intl.DisplayNames uses either regional spelling across supported browser/CLDR versions.
  await expect(page.getByRole('button', { name: /^Play in (Mexican Spanish|Spanish \(Mexico\))$/ })).toHaveText('ES-MX');
  await expect(page.getByRole('button', { name: 'Play in Spanish', exact: true })).toHaveText('ES-ES');
  await leaveBoard(page);
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.getByRole('button', { name: 'Edit tile Hola', exact: true }).click();
  await page.getByRole('button', { name: 'Change original language', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Language tag', exact: true })).toHaveValue('es-MX');
  await expect(page.getByRole('button', { name: 'Choose tile language Russian', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close Edit tile', exact: true }).click();
  await page.getByRole('button', { name: 'Add a tile', exact: true }).click();
  await page.getByRole('button', { name: 'Change original language', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Language tag', exact: true })).toHaveValue('es-MX');
  await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  let generationRequests = 0;
  await page.route('**/api/speech', route => route.fulfill({ status: 503, json: { error: 'Test device voice fallback' } }));
  await page.route('**/api/boards/propose', route => {
    const input = route.request().postDataJSON(); generationRequests++;
    expect(input.languageProfile).toEqual({ languages: ['es-MX', 'es-ES'], defaultLanguage: 'es-MX' });
    return route.fulfill({ json: { boardId: null, baseRevision: null, proposal: { title: 'Fruta', explanation: 'One fruit card.', needsClarification: false, playLanguages: ['es-MX', 'es-ES'], tiles: [{ existingId: null, label: 'Manzana', speech: 'Manzana', language: 'es-MX', color: 'rose', emoji: '🍎', languageMode: 'board', translations: [{ language: 'es-ES', label: 'Manzana', speech: 'Manzana' }] }] } } });
  });
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill('One apple card');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();

  await page.getByRole('button', { name: 'Use this board', exact: true }).click();
  expect(generationRequests).toBe(1);
  await expect(page.getByRole('button', { name: 'Edit tile Manzana', exact: true })).toBeVisible();
});

test('starter library, manual edit, mixed-language data, and persistence', async ({ page }) => {
  await page.getByRole('button', { name: 'Edit Our family', exact: true }).click();
  await page.getByRole('button', { name: 'Edit tile Babushka', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'What it says', exact: true })).toHaveValue('бабушка');
  await page.getByRole('textbox', { name: 'Words on the tile', exact: true }).fill('Baba');
  await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit tile Baba', exact: true })).toBeVisible();
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Edit Our family', exact: true }).click();
  await page.getByRole('button', { name: 'Edit tile Baba', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'What it says', exact: true })).toHaveValue('бабушка');
});

test('complete emoji search finds blueberries for a plum card and persists offline', async ({ page, context }) => {
  await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
  await page.getByRole('button', { name: 'Edit tile Cow', exact: true }).click();
  await page.getByRole('textbox', { name: 'Words on the tile', exact: true }).fill('Plum');
  await page.getByRole('textbox', { name: 'What it says', exact: true }).fill('Plum');
  await page.getByRole('button', { name: 'Choose emoji', exact: true }).click();
  const emojiButtons = page.getByRole('button', { name: /^Use .+ emoji$/ });
  await expect(emojiButtons).toHaveCount(64);
  await page.getByRole('button', { name: 'Show more emoji', exact: true }).click();
  await expect(emojiButtons).toHaveCount(128);
  const search = page.getByRole('textbox', { name: 'Search emoji', exact: true });
  await search.fill('blueberry');
  const blueberries = page.getByRole('button', { name: 'Use blueberries emoji', exact: true });
  await expect(blueberries).toBeVisible();
  await search.fill('blueberries');
  await expect(blueberries).toBeVisible();
  await search.fill('no-such-emoji-xyz');
  await expect(page.getByText('No matching emoji. Try another word or paste an emoji.')).toBeVisible();
  await search.fill('🫐');
  await expect(blueberries).toBeVisible();
  await search.fill('blueberry');
  await page.getByRole('button', { name: 'Hide emoji', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/screenshots/emoji-blueberries.png' });
  await blueberries.click();
  await expect(page.getByRole('textbox', { name: 'Words on the tile', exact: true })).toHaveValue('Plum');
  await expect(page.getByRole('textbox', { name: 'What it says', exact: true })).toHaveValue('Plum');
  await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit tile Plum', exact: true })).toBeVisible();
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit tile Plum', exact: true }).getByText('🫐', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit tile Plum', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Words on the tile', exact: true })).toHaveValue('Plum');
  await expect(page.getByRole('textbox', { name: 'What it says', exact: true })).toHaveValue('Plum');
  await page.getByRole('button', { name: 'Choose emoji', exact: true }).click();
  await search.fill('голубика');
  await expect(blueberries).toBeVisible();
});

test('swipes are forgiving, speech is bounded, and parent editing needs a deliberate hold and release', async ({ page }) => {
  await page.getByRole('button', { name: 'Play Farmyard friends', exact: true }).click();
  const cow = (await page.getByRole('button', { name: 'Cow', exact: true }).boundingBox())!;
  const sheep = (await page.getByRole('button', { name: 'Sheep', exact: true }).boundingBox())!;
  await page.mouse.move(cow.x + 40, cow.y + 40); await page.mouse.down();
  await page.mouse.move(sheep.x + 40, sheep.y + 40, { steps: 10 }); await page.mouse.up();
  expect(await page.evaluate(() => (window as any).__spoken.map((s: any) => s.text))).toEqual(['Cow']);
  await page.getByRole('button', { name: 'Sheep', exact: true }).click();
  await page.getByRole('button', { name: 'Horse', exact: true }).click();
  await finishSpeech(page);
  expect(await page.evaluate(() => (window as any).__spoken.map((s: any) => s.text))).toEqual(['Cow', 'Horse']);
  await finishSpeech(page);
  await page.mouse.move(cow.x + cow.width + 6, cow.y + 30); await page.mouse.down();
  await page.mouse.move(sheep.x + 30, sheep.y + 30); await page.mouse.up();
  expect(await page.evaluate(() => (window as any).__spoken.at(-1).text)).toBe('Sheep');
  await page.getByTestId('parent-control').click(); await expect(page.getByText('Leave this board?')).toHaveCount(0);
  const control = (await page.getByTestId('parent-control').boundingBox())!;
  await page.mouse.move(control.x + 20, control.y + 20); await page.mouse.down(); await page.mouse.move(control.x - 20, control.y + 20);
  await page.waitForTimeout(2100); await page.mouse.up(); await expect(page.getByText('Leave this board?')).toHaveCount(0);
  await leaveBoard(page); await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await expect(page.getByText('Your soundboards', { exact: true })).toBeVisible();
});

test('unlock readiness matches release at the boundary and cancelled holds reset immediately', async ({ page }) => {
  await page.getByRole('button', { name: 'Play Farmyard friends', exact: true }).click();
  const control = page.getByTestId('parent-control'); await expect(control).toBeVisible();
  // The measured grid's first layout cancels active holds. Let it finish before freezing time.
  await expect(page.getByRole('button', { name: 'Cow', exact: true })).toBeVisible();
  await page.clock.install({ time: new Date('2026-10-03T20:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-03T20:00:01Z'));
  const down = async () => { const box = (await control.boundingBox())!; await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down(); await expect(control).toHaveText('Keep holding…'); return box; };
  await down(); await page.clock.runFor(1999);
  await expect(control).toHaveText('Keep holding…'); await page.mouse.up();
  await expect(page.getByText('Leave this board?', { exact: true })).toHaveCount(0);
  for (let i = 0; i < 3; i++) {
    await down(); await page.clock.runFor(1999); await expect(control).toHaveText('Keep holding…');
    await page.clock.runFor(1); await expect(control).toHaveText('Release to edit');
    await page.mouse.up(); await page.clock.runFor(800); await expect(page.getByRole('heading', { name: 'Edit board', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Return to play', exact: true }).click(); await expect(control).toBeVisible(); await page.clock.runFor(100);
  }
  for (const elapsed of [1500, 2000]) {
    const box = await down(); await page.clock.runFor(elapsed);
    await page.mouse.move(box.x + 40, box.y + 20);
    await expect(control).toHaveText('Hold to unlock');
    await page.clock.runFor(3000); await expect(control).toHaveText('Hold to unlock');
    await page.mouse.up(); await expect(page.getByText('Leave this board?', { exact: true })).toHaveCount(0);
  }
});

test('another touch cancels the ready unlock state without leaving stale feedback', async ({ page, context }) => {
  await page.getByRole('button', { name: 'Play Farmyard friends', exact: true }).click();
  // Let the initial board layout finish before freezing timers; layout resets the hold gesture.
  await expect(page.getByRole('button', { name: 'Cow', exact: true })).toBeVisible();
  const control = page.getByTestId('parent-control'); await expect(control).toBeVisible();
  await page.clock.install({ time: new Date('2026-10-03T20:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-03T20:00:01Z'));
  const box = (await control.boundingBox())!, x = Math.round(box.x + 20), y = Math.round(box.y + 20);
  const session = await context.newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await expect(control).toHaveText('Keep holding…');
  await page.clock.runFor(2000); await expect(control).toHaveText('Release to edit');
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }, { x: x + 40, y, id: 2 }] });
  await expect(control).toHaveText('Hold to unlock');
  await page.clock.runFor(3000); await expect(control).toHaveText('Hold to unlock');
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByText('Leave this board?', { exact: true })).toHaveCount(0);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 3 }] });
  await expect(control).toHaveText('Keep holding…');
  await page.clock.runFor(2000); await expect(control).toHaveText('Release to edit');
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.clock.runFor(800); await expect(page.getByRole('heading', { name: 'Edit board', exact: true })).toBeVisible();
});

test('active board survives reload and uses Russian pronunciation', async ({ page }) => {
  await page.getByRole('button', { name: 'Play Our family', exact: true }).click();
  await expect(page.getByTestId('play-board')).toBeVisible();
  await page.reload(); await expect(page.getByTestId('play-board')).toBeVisible();
  await page.getByRole('button', { name: 'Babushka', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__spoken)).toEqual([{ text: 'бабушка', lang: 'ru-RU' }]);
  await leaveBoard(page);
});

test('tap feedback never steals the playing highlight during repeated queued taps', async ({ page }) => {
  await page.getByRole('button', { name: 'Play Farmyard friends', exact: true }).click();
  const cow = page.getByRole('button', { name: 'Cow', exact: true });
  const sheep = page.getByRole('button', { name: 'Sheep', exact: true });
  const horse = page.getByRole('button', { name: 'Horse', exact: true });
  await expect(cow).toBeVisible();
  await expect(page.getByTestId('parent-control')).toHaveText('Hold to unlock');
  await expect(page.getByText('Touch a picture. Hear a word.')).toHaveCount(0);
  await page.clock.install({ time: new Date('2026-10-03T20:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-03T20:00:01Z'));
  await cow.click();
  await expect(cow.getByTestId('tile-playing')).toBeVisible();
  await expect(cow.getByTestId('tile-tap')).toBeVisible();
  await page.clock.runFor(200);
  const labelBefore = await cow.getByText('Cow', { exact: true }).boundingBox();
  for (const next of [sheep, horse, sheep]) {
    await next.click();
    await expect(cow.getByTestId('tile-playing')).toBeVisible();
    await expect(next.getByTestId('tile-tap')).toBeVisible();
    await expect(next.getByTestId('tile-playing')).toHaveCount(0);
    await page.clock.runFor(90);
    await expect(cow.getByTestId('tile-playing')).toBeVisible();
    await expect(next.getByTestId('tile-tap')).toBeVisible();
    await page.clock.runFor(100);
    await expect(next.getByTestId('tile-tap')).toHaveCount(0);
    await expect(cow.getByTestId('tile-playing')).toBeVisible();
    expect(await cow.getByText('Cow', { exact: true }).boundingBox()).toEqual(labelBefore);
  }
  await sheep.click();
  await page.screenshot({ path: 'artifacts/screenshots/separate-tap-and-play.png' });
  await finishSpeech(page);
  await expect(cow.getByTestId('tile-playing')).toHaveCount(0);
  await expect(sheep.getByTestId('tile-playing')).toBeVisible();
  await expect(sheep.getByTestId('tile-tap')).toBeVisible();
  await page.clock.runFor(200);
  await expect(sheep.getByTestId('tile-tap')).toHaveCount(0);
  await expect(sheep.getByTestId('tile-playing')).toBeVisible();
  await finishSpeech(page);
  await expect(page.getByTestId('tile-playing')).toHaveCount(0);
});

test('board languages translate switchable cards, preserve fixed cards, and save translated audio offline', async ({ page, context }) => {
  const wave = pcmToWav(Buffer.alloc(24000));
  const id = createHash('sha256').update(wave).digest('hex');
  const requests: any[] = [];
  await page.route('**/api/speech', route => {
    const input = route.request().postDataJSON(); requests.push(input);
    return input.text === 'коровушка' ? route.fulfill({ json: { ...input, id, cacheHit: false } }) : route.fulfill({ status: 503, json: { error: 'Test audio unavailable' } });
  });
  await page.route('**/api/speech/*.wav', route => route.fulfill({ body: wave, contentType: 'audio/wav' }));
  const translations: Record<string, string> = { Cow: 'Корова', Horse: 'Лошадь', Pig: 'Свинья', Chicken: 'Курица', Duck: 'Утка' };
  await page.route('**/api/boards/translate', route => {
    const input = route.request().postDataJSON();
    expect(input.tiles).toHaveLength(5);
    expect(input.tiles.some((t: any) => t.label === 'Sheep')).toBe(false);
    return route.fulfill({ json: { boardId: input.boardId, baseRevision: input.baseRevision, translations: input.tiles.flatMap((t: any) => t.targets.map((language: string) => ({ tileId: t.id, language, label: translations[t.label], speech: translations[t.label].toLowerCase() }))) } });
  });
  await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
  await page.getByRole('button', { name: 'Languages', exact: true }).click();
  await page.getByRole('button', { name: 'Choose languages', exact: true }).click();
  await page.getByRole('button', { name: 'Add play language English', exact: true }).click();
  await page.getByRole('button', { name: 'More languages', exact: true }).click();
  await page.getByRole('button', { name: 'Add play language Russian', exact: true }).click();
  await page.getByRole('button', { name: 'Done choosing', exact: true }).click();
  await page.getByRole('button', { name: 'Make all cards switchable', exact: true }).click();
  await page.getByRole('button', { name: 'Close Board languages', exact: true }).click();
  await page.getByRole('button', { name: 'Edit tile Sheep', exact: true }).click();
  await page.getByRole('button', { name: 'Keep this card’s language', exact: true }).click();
  await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  await page.getByRole('button', { name: 'Languages', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare translations (5)', exact: true }).click();
  await expect(page.getByText('Review translations', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use translations', exact: true }).click();
  await page.getByRole('button', { name: 'Edit tile Cow', exact: true }).click();
  await page.getByRole('button', { name: 'Edit in Russian', exact: true }).last().click();
  await expect(page.getByRole('textbox', { name: 'Russian spoken words', exact: true })).toHaveValue('корова');
  await page.getByRole('textbox', { name: 'Russian spoken words', exact: true }).fill('коровушка');
  await page.getByRole('button', { name: 'Generate audio', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Regenerate audio', exact: true })).toBeEnabled();
  expect(requests).toContainEqual({ text: 'коровушка', language: 'ru-RU', regenerate: false });
  await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  await page.getByRole('button', { name: 'Play board', exact: true }).click();
  await page.getByRole('button', { name: 'Cow', exact: true }).click();
  await page.getByRole('button', { name: 'Sheep', exact: true }).click();
  await page.getByRole('button', { name: 'Play in Russian', exact: true }).click();
  await expect(page.getByTestId('tile-playing')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Корова', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sheep', exact: true })).toBeVisible();
  await finishSpeech(page); // The cancelled English queue must not resume.
  expect(await page.evaluate(() => (window as any).__spoken)).toEqual([{ text: 'Cow', lang: 'en-US' }]);
  await page.getByRole('button', { name: 'Лошадь', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__spoken.at(-1))).toEqual({ text: 'лошадь', lang: 'ru-RU' });
  await finishSpeech(page);
  await page.getByRole('button', { name: 'Sheep', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__spoken.at(-1))).toEqual({ text: 'Sheep', lang: 'en-US' });
  await finishSpeech(page);
  await page.screenshot({ path: 'artifacts/screenshots/play-bilingual.png' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true); await page.reload();
  await expect(page.getByRole('button', { name: 'Корова', exact: true })).toBeVisible();
  await page.evaluate(() => { const original = HTMLMediaElement.prototype.play; (window as any).__played = []; HTMLMediaElement.prototype.play = function () { (window as any).__played.push(this.src); return original.call(this); }; });
  await page.getByRole('button', { name: 'Корова', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__played.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).__spoken)).toEqual([]);
  await page.getByRole('button', { name: 'Play in English', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cow', exact: true })).toBeVisible();
});

test('board card menu confirms deletion and preserves other boards after reload', async ({ page }) => {
  await page.getByRole('button', { name: 'More options for Farmyard friends', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Board title', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Generate missing audio (6)', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'artifacts/screenshots/board-card-menu.png' });
  await page.getByRole('button', { name: 'Delete board', exact: true }).click();
  await expect(page.getByText('Delete “Farmyard friends” from this device? This cannot be undone.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Keep board', exact: true }).click();
  await page.getByRole('button', { name: 'Close Farmyard friends', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play Farmyard friends', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'More options for Farmyard friends', exact: true }).click();
  await page.getByRole('button', { name: 'Delete board', exact: true }).click();
  await page.getByRole('button', { name: 'Delete board', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play Farmyard friends', exact: true })).toHaveCount(0);
  await expect(page.getByText('Saving…', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'More options for Farmyard friends', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play My little words', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play Our family', exact: true })).toBeVisible();
});

test('board card menu fills missing translated audio, continues when closed, retries failures, and hides when complete', async ({ page }) => {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('little-say'); request.onsuccess = () => resolve(request.result); });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite'); const store = tx.objectStore('state'); const request = store.get('library');
      request.onsuccess = () => {
        const library = request.result; library.settings.aiConsent = true; library.settings.voiceSources = { 'en-US': 'ai', 'es-ES': 'ai' };
        const board = library.boards[0]; board.tiles = board.tiles.slice(0, 2); board.playLanguages = ['en-US', 'es-ES'];
        const cow = board.tiles[0]; cow.languageMode = 'board';
        cow.translations = [{ language: 'es-ES', label: 'Vaca', speech: 'Vaca', source: JSON.stringify([cow.label, cow.speech, cow.language]) }];
        board.tiles.push({ ...cow, id: 'duplicate-cow' }); library.boards = [board];
        store.put(library, 'library');
      };
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    }); db.close();
  });
  // Unload the initial fixture so its pending speech requests cannot enter this scenario.
  await page.goto('/');
  const wave = pcmToWav(Buffer.alloc(24000)); const id = createHash('sha256').update(wave).digest('hex');
  const attempts: Record<string, number> = {};
  let releaseTranslation!: () => void;
  const translationGate = new Promise<void>(resolve => { releaseTranslation = resolve; });
  await page.route('**/api/speech', async route => {
    const input = route.request().postDataJSON(); attempts[input.text] = (attempts[input.text] ?? 0) + 1;
    expect(input.regenerate).toBe(false);
    if (input.text === 'Vaca') { expect(input.language).toBe('es-ES'); await translationGate; }
    return input.text === 'Sheep' && attempts.Sheep === 1 ? route.fulfill({ status: 503, json: { error: 'Try again' } }) : route.fulfill({ json: { ...input, id, cacheHit: true } });
  });
  await page.route('**/api/speech/*.wav', route => route.fulfill({ body: wave, contentType: 'audio/wav' }));
  await page.goto('/app');
  await page.getByRole('button', { name: 'More options for Farmyard friends', exact: true }).click();
  await expect.poll(() => attempts.Vaca).toBe(1);
  await expect(page.getByText('Generating audio… 1 of 3 saved.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close Farmyard friends', exact: true }).click();
  releaseTranslation();
  await page.getByRole('button', { name: 'More options for Farmyard friends', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Generate missing audio (1)', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Generate missing audio (1)', exact: true }).click();
  await expect(page.getByText('All AI audio saved on this device.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Generate missing audio/ })).toHaveCount(0);
  expect(attempts).toEqual({ Cow: 1, Vaca: 1, Sheep: 2 });
  await page.getByRole('button', { name: 'Close Farmyard friends', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'More options for Farmyard friends', exact: true }).click();
  await expect(page.getByText('All AI audio saved on this device.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Generate missing audio/ })).toHaveCount(0);
  expect(attempts).toEqual({ Cow: 1, Vaca: 1, Sheep: 2 });
});

test('board audio retry fills only clips that automatic AI preparation could not save', async ({ page }) => {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('little-say'); request.onsuccess = () => resolve(request.result); });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite'); const store = tx.objectStore('state'); const request = store.get('library');
      request.onsuccess = () => { const library = request.result; library.settings.aiConsent = true; library.settings.voiceSources = { 'en-US': 'ai', 'es-ES': 'ai' }; library.boards[0].tiles = library.boards[0].tiles.slice(0, 2); library.boards = [library.boards[0]]; store.put(library, 'library'); };
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    }); db.close();
  });
  // Unload the initial fixture so its pending speech requests cannot enter this scenario.
  await page.goto('/');
  const wave = pcmToWav(Buffer.alloc(24000)); const id = createHash('sha256').update(wave).digest('hex');
  const attempts: Record<string, number> = {};
  await page.route('**/api/speech', route => {
    const input = route.request().postDataJSON(); attempts[input.text] = (attempts[input.text] ?? 0) + 1;
    expect(input.regenerate).toBe(false);
    return input.text === 'Sheep' && attempts.Sheep === 1 ? route.fulfill({ status: 503, json: { error: 'Try again' } }) : route.fulfill({ json: { ...input, id, cacheHit: true } });
  });
  await page.route('**/api/speech/*.wav', route => route.fulfill({ body: wave, contentType: 'audio/wav' }));
  await page.goto('/app');
  await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry missing audio (1)', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Retry missing audio (1)', exact: true }).click();
  await expect(page.getByRole('button', { name: 'All audio saved', exact: true })).toBeDisabled();
  expect(attempts).toEqual({ Cow: 1, Sheep: 2 });
});

test('numbers 1–9 get a visible bilingual setup and switch speech while preserving digit labels', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Languages', exact: true }).click();
  await page.getByRole('button', { name: 'More languages', exact: true }).click();
  await page.getByRole('button', { name: 'Add device language Russian', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('little-say'); request.onsuccess = () => resolve(request.result); });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite'); const store = tx.objectStore('state'); const request = store.get('library');
      request.onsuccess = () => {
        const library = request.result; const board = library.boards[0];
        const tile = board.tiles[0]; board.title = 'Numbers 1–9';
        board.tiles = Array.from({ length: 9 }, (_, i) => ({ ...tile, id: `number-${i + 1}`, label: `${i + 1}`, speech: `${i + 1}`, languageMode: 'fixed', color: ['sage', 'peach', 'butter', 'sky', 'lilac', 'rose'][i % 6], illustration: { kind: 'emoji', emoji: `${i + 1}\uFE0F\u20E3` } }));
        library.boards = [board]; store.put(library, 'library');
      };
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    }); db.close();
  });
  const russian = ['один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
  const audioRequests: any[] = []; let attempts = 0;
  await page.route('**/api/speech', route => { audioRequests.push(route.request().postDataJSON()); return route.fulfill({ status: 503, json: { error: 'Test device speech fallback' } }); });
  await page.route('**/api/boards/translate', route => {
    const input = route.request().postDataJSON(); attempts++;
    expect(input.tiles).toHaveLength(9);
    expect(input.tiles.every((tile: any) => tile.targets.length === 1 && tile.targets[0] === 'ru-RU')).toBe(true);
    if (attempts === 1) return route.fulfill({ status: 503, json: { error: 'Connection interrupted. Try again.' } });
    return route.fulfill({ json: { boardId: input.boardId, baseRevision: input.baseRevision, translations: input.tiles.map((tile: any) => ({ tileId: tile.id, language: 'ru-RU', label: tile.label, speech: russian[Number(tile.label) - 1] })) } });
  });
  await page.reload(); await page.setViewportSize({ width: 820, height: 1180 });
  await page.getByRole('button', { name: 'Edit Numbers 1–9', exact: true }).click();
  const languages = page.getByRole('button', { name: 'Languages', exact: true });
  expect((await languages.boundingBox())!.y).toBeLessThan(100);
  await languages.click();
  await expect(page.getByRole('button', { name: 'English + Russian', exact: true })).toBeVisible();
  await page.waitForTimeout(300); // Let the native-style sheet fade finish for the screenshot.
  await page.screenshot({ path: 'artifacts/screenshots/numbers-bilingual-setup.png' });
  await page.getByRole('button', { name: 'English + Russian', exact: true }).click();
  await expect(page.getByText('Connection interrupted. Try again.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'English + Russian', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review board languages', exact: true })).toBeVisible();
  // Preparing translations does not enable a partly configured board before review.
  expect(await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('little-say'); request.onsuccess = () => resolve(request.result); });
    const board = await new Promise<any>(resolve => { const request = db.transaction('state').objectStore('state').get('library'); request.onsuccess = () => resolve(request.result.boards[0]); }); db.close();
    return { languages: board.playLanguages ?? [], fixed: board.tiles.every((tile: any) => tile.languageMode === 'fixed') };
  })).toEqual({ languages: [], fixed: true });
  await page.getByRole('button', { name: 'Use these languages', exact: true }).click();
  await expect.poll(() => audioRequests.length).toBe(18);
  expect(audioRequests.filter(t => t.language === 'ru-RU').map(t => t.text).sort()).toEqual([...russian].sort());
  expect(audioRequests.filter(t => t.language === 'en-US').map(t => t.text).sort()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  await page.getByRole('button', { name: 'Play board', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play in English', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '1', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__spoken.at(-1))).toEqual({ text: '1', lang: 'en-US' });
  await page.getByRole('button', { name: 'Play in Russian', exact: true }).click();
  await expect(page.getByTestId('tile-playing')).toHaveCount(0);
  await page.getByRole('button', { name: '1', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__spoken.at(-1))).toEqual({ text: 'один', lang: 'ru-RU' });
  await finishSpeech(page);
  await page.getByRole('button', { name: '9', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__spoken.at(-1))).toEqual({ text: 'девять', lang: 'ru-RU' });
  await page.screenshot({ path: 'artifacts/screenshots/numbers-bilingual-play.png' });
  await page.getByRole('button', { name: 'Play in English', exact: true }).click();
  await page.getByRole('button', { name: '9', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__spoken.at(-1))).toEqual({ text: '9', lang: 'en-US' });
});

test('AI proposal requires review, applies safely, and can be undone', async ({ page }) => {
  await page.route('**/api/boards/propose', async route => {
    const input = route.request().postDataJSON();
    await route.fulfill({ json: { boardId: input.board?.id ?? null, baseRevision: input.board?.revision ?? null, proposal: { title: 'Duck pond', explanation: 'Replaced horse with duck.', needsClarification: false, tiles: input.board.tiles.map((t: any) => t.label === 'Horse' ? { existingId: null, label: 'Duckling', speech: 'Duckling', language: 'en-US', color: 'butter', emoji: '🦆' } : { existingId: t.id, label: t.label, speech: t.speech, language: t.language, color: t.color, emoji: t.emoji }) } } });
  });
  await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
  await page.getByRole('button', { name: 'Edit with AI', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill('Replace horse with duckling');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Duck pond', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit tile Duckling', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo last board change', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit tile Horse', exact: true })).toBeVisible();
});

test('offline shell and local boards survive a disconnected reload', async ({ page, context }) => {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await expect(page.getByText('Your soundboards', { exact: true })).toBeVisible();
  await context.setOffline(true); await page.reload();
  await expect(page.getByText('Your soundboards', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Play Farmyard friends', exact: true }).click();
  await page.getByRole('button', { name: 'Cow', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__spoken.at(-1).text)).toBe('Cow');
});

test('tablet layouts and screenshots stay within the viewport', async ({ page }) => {
  await mkdir('artifacts/screenshots', { recursive: true });
  await page.screenshot({ path: 'artifacts/screenshots/library-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.screenshot({ path: 'artifacts/screenshots/library-tablet.png', fullPage: true });
  await page.getByRole('button', { name: 'Play Farmyard friends', exact: true }).click();
  await expect(page.getByTestId('touch-surface')).toBeVisible();
  for (const orientation of [{ width: 820, height: 1180 }, { width: 1180, height: 820 }]) {
    await page.setViewportSize(orientation);
    await expect(async () => { const bounds = (await page.getByRole('button', { name: 'Duck', exact: true }).boundingBox())!; expect(bounds.y + bounds.height).toBeLessThanOrEqual(orientation.height); }).toPass();
  }
  await page.screenshot({ path: 'artifacts/screenshots/play-tablet-landscape.png' });
});

test('24 tiles fit in both tablet orientations and remain keyboard accessible', async ({ page }) => {
  const tiles = Array.from({ length: 24 }, (_, i) => ({ existingId: null, label: `Word ${i + 1}`, speech: `Word ${i + 1}`, language: i === 23 ? 'ru-RU' : 'en-US', emoji: ['🐄', '🐑', '🐴', '🐷', '🐔', '🦆'][i % 6], color: ['sage', 'peach', 'butter', 'sky', 'lilac', 'rose'][i % 6] }));
  await page.route('**/api/boards/propose', route => route.fulfill({ json: { boardId: null, baseRevision: null, proposal: { title: 'All my words', explanation: '24 everyday words.', needsClarification: false, tiles } } }));
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill('Create exactly 24 tiles');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByRole('button', { name: 'Use this board', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add a tile', exact: true })).toHaveCount(0);
  for (const size of [{ width: 820, height: 1180 }, { width: 1180, height: 820 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(size);
    const tiles = page.getByTestId('editor-preview').getByRole('button');
    await expect(tiles).toHaveCount(24);
    for (const tile of await tiles.all()) await expect(tile).toBeInViewport({ ratio: 1 });
    for (const name of ['Edit with AI', 'Duplicate board', 'Delete board', 'Languages', 'Play board']) await expect(page.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: `artifacts/screenshots/editor-24-${size.width}.png` });
  }
  await page.getByRole('button', { name: 'Play board', exact: true }).click();
  for (const size of [{ width: 820, height: 1180 }, { width: 1180, height: 820 }]) {
    await page.setViewportSize(size);
    await expect(async () => {
      const buttons = page.getByTestId('touch-surface').getByRole('button'); expect(await buttons.count()).toBe(24);
      for (const tile of await buttons.all()) { const bounds = (await tile.boundingBox())!; expect(bounds.width).toBeGreaterThan(100); expect(bounds.height).toBeGreaterThan(100); expect(bounds.x + bounds.width).toBeLessThanOrEqual(size.width); expect(bounds.y + bounds.height).toBeLessThanOrEqual(size.height); }
    }).toPass();
  }
  await page.getByRole('button', { name: 'Word 24', exact: true }).focus(); await page.keyboard.press('Enter');
  expect(await page.evaluate(() => (window as any).__spoken)).toEqual([{ text: 'Word 24', lang: 'ru-RU' }]);
  await page.screenshot({ path: 'artifacts/screenshots/play-24-tiles.png' });
});

test('photo attachments survive reload and remain on the device', async ({ page }) => {
  await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
  await page.getByRole('button', { name: 'Edit tile Cow', exact: true }).click();
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Choose photo', exact: true }).click();
  await (await chooser).setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64') });
  await page.getByTestId('photo-crop-surface').focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('+');
  await page.getByRole('button', { name: 'Use photo', exact: true }).click();
  await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
  await page.reload(); await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click(); await page.getByRole('button', { name: 'Edit tile Cow', exact: true }).click();
  await page.getByRole('button', { name: 'Adjust crop', exact: true }).click();
  await expect(page.getByText('125%', { exact: true })).toBeVisible();
  await expect(page.getByText('Photo unavailable', { exact: true })).toHaveCount(0);
});

test('failed local writes are visible, retryable, and do not enter play prematurely', async ({ page }) => {
  await page.evaluate(() => { const original = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...args: any[]) { if ((window as any).__failWrites) throw new DOMException('Storage full', 'QuotaExceededError'); return original.apply(this, args as any); }; (window as any).__failWrites = true; });
  await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
  await page.getByRole('textbox', { name: 'Board title', exact: true }).fill('My farm');
  await expect(page.getByRole('button', { name: 'Retry saving', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Play board', exact: true }).click();
  await expect(page.getByText('The play session could not be saved.', { exact: false })).toBeVisible();
  await expect(page.getByTestId('play-board')).toHaveCount(0);
  await page.evaluate(() => { (window as any).__failWrites = false; });
  await page.getByRole('button', { name: 'Retry saving', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry saving', exact: true })).toHaveCount(0);
  await page.reload();
  // Retrying saves the edits without reviving a failed navigation request after restart.
  await expect(page.getByTestId('play-board')).toHaveCount(0);
  await page.getByRole('button', { name: 'Play My farm', exact: true }).click();
  await expect(page.getByTestId('play-board')).toBeVisible(); await expect(page.getByText('My farm', { exact: true })).toBeVisible();
});

test('missing AI configuration retains the parent prompt and existing boards', async ({ page }) => {
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill('A farm with six animals');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('AI is not configured yet.', { exact: false })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message to AI', exact: true })).toHaveValue('A farm with six animals');
  await page.getByRole('button', { name: 'Back to boards', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play Farmyard friends', exact: true })).toBeVisible();
});
