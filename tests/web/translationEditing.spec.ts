/** @file Verifies signed-in account navigation, a primary-language canvas, per-card drafts, shared language choices, background translations, and protected corrections. */

import { test, expect, type Page } from '@playwright/test';
import { waitForAiTurn, openBoardLanguages } from './boardEditor';
import { createHash } from 'node:crypto';
import { tileSource } from '../../packages/core/src/schema';
import { starterLibrary } from '../fixtures/library';
import { pcmToWav } from '../../apps/server/src/synthesis';
import { openExistingLibrary } from './existingLibrary';

async function openTranslations(page: Page, missingSpanish = false, legacy = false) {
  await page.addInitScript(() => {
    const w = window as any; w.__spoken = [];
    w.SpeechSynthesisUtterance = class {
      /** Retain the requested words for deterministic browser speech assertions. */
      constructor(public text: string) {}
    };
    Object.defineProperty(w, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => ['en-US', 'ru-RU', 'es-ES'].map(lang => ({ voiceURI: lang, lang, name: lang, localService: true })),
      speak: (value: any) => { w.__spoken.push({ text: value.text, language: value.lang }); value.onend?.(); },
      cancel() {}, addEventListener() {}, removeEventListener() {},
    } });
    Element.prototype.requestFullscreen = async () => {};
  });
  await openExistingLibrary(page);
  const library = starterLibrary(); const board = library.boards[0]; library.boards = [board];
  board.tiles = board.tiles.slice(0, 2); board.playLanguages = ['en-US', 'ru-RU', 'es-ES']; board.translateLabels = false;
  board.tiles[0].languageMode = 'board'; board.tiles[1].languageMode = 'fixed';
  board.tiles[0].translations = [{ language: 'ru-RU', label: 'Корова', speech: 'корова', source: tileSource(board.tiles[0]), origin: 'manual' }, { language: 'es-ES', label: 'Vaca', speech: 'vaca', source: tileSource(board.tiles[0]), origin: 'generated' }];
  if (missingSpanish) board.tiles[0].translations.pop();
  if (legacy) delete board.tiles[0].translations[0].origin;
  library.settings = { ...library.settings, languageProfile: { languages: board.playLanguages, defaultLanguage: 'en-US' }, aiConsent: true, voiceSources: { 'en-US': 'ai', 'ru-RU': 'ai', 'es-ES': 'ai' }, boardLanguages: { [board.id]: 'ru-RU' } };
  await page.evaluate(async library => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('little-say'); request.onsuccess = () => resolve(request.result); });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put(library, 'library'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
  }, library);
  await page.reload();
  if (!page.url().includes('/edit')) await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
  return board;
}
async function openRussianTile(page: Page) {
  await page.getByRole('button', { name: 'Edit tile Cow', exact: true }).click();
  await page.getByRole('button', { name: 'Edit in Russian', exact: true }).click();
}
async function savedBoard(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('little-say'); request.onsuccess = () => resolve(request.result); });
    return new Promise<any>(resolve => { const request = db.transaction('state').objectStore('state').get('library'); request.onsuccess = () => { db.close(); resolve(request.result.boards[0]); }; });
  });
}

test('canvas stays in the primary language while individual cards retain their language drafts', async ({ page }) => {
  const original = await openTranslations(page);
  await expect(page.getByRole('button', { name: 'Edit tile Cow', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit tile Sheep', exact: true })).toBeVisible();
  await expect(page.getByText('Editing language', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit in Russian', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit tile Cow', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Words on the tile', exact: true })).toHaveValue('Cow');
  await page.getByRole('button', { name: 'Edit in Russian', exact: true }).click();
  const label = page.getByRole('textbox', { name: 'Russian words on the tile', exact: true });
  const speech = page.getByRole('textbox', { name: 'Russian spoken words', exact: true });
  await expect(label).toHaveValue('Корова'); await speech.fill('коровушка'); await label.fill('Моя корова');
  await page.getByRole('button', { name: 'Edit in Spanish', exact: true }).last().click();
  await expect(page.getByRole('textbox', { name: 'Spanish spoken words', exact: true })).toHaveValue('vaca');
  await page.getByRole('button', { name: 'Edit in Russian', exact: true }).last().click();
  await expect(speech).toHaveValue('коровушка');
  await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  await expect.poll(async () => (await savedBoard(page)).tiles[0].translations[1].speech).toBe('коровушка');
  const saved = await savedBoard(page);
  expect(saved.tiles[0]).toMatchObject({ id: original.tiles[0].id, label: 'Cow', speech: 'Cow', language: 'en-US', illustration: original.tiles[0].illustration });
  expect(saved.tiles[0].translations.find((t: any) => t.language === 'es-ES')).toEqual(original.tiles[0].translations![1]);
  await page.reload();
  if (!page.url().includes('/edit')) await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
  await openRussianTile(page); await expect(speech).toHaveValue('коровушка');
  await speech.fill('Discard me'); await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await openRussianTile(page); await expect(speech).toHaveValue('коровушка');
});

test('account navigation preserves corrected translations and the signed-in library', async ({ page }) => {
  const original = await openTranslations(page);
  await openRussianTile(page);
  await page.getByRole('textbox', { name: 'Russian spoken words', exact: true }).fill('Saved Russian correction');
  await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  await expect.poll(async () => (await savedBoard(page)).tiles[0].translations.find((t: any) => t.language === 'ru-RU').speech).toBe('Saved Russian correction');
  const corrected = await savedBoard(page);
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await page.getByRole('button', { name: 'Account & backup', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to boards', exact: true }).click();
  await page.reload();
  if (!page.url().includes('/edit')) await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
  await openRussianTile(page);
  await expect(page.getByRole('textbox', { name: 'Russian spoken words', exact: true })).toHaveValue('Saved Russian correction');
  expect(await savedBoard(page)).toEqual(corrected);
  expect(corrected.tiles[0]).toMatchObject({ label: original.tiles[0].label, speech: original.tiles[0].speech, illustration: original.tiles[0].illustration });
  expect(corrected.tiles[1]).toEqual(original.tiles[1]);
  expect(corrected.tiles[0].translations.find((t: any) => t.language === 'es-ES')).toEqual(original.tiles[0].translations![1]);
});

for (const legacy of [false, true]) test(`empty ${legacy ? 'legacy' : 'manual'} corrections refuse save and duplicate; cancel and reload preserve saved words`, async ({ page }) => {
  const original = await openTranslations(page, false, legacy);
  await openRussianTile(page);
  await page.getByRole('textbox', { name: 'Russian words on the tile', exact: true }).fill('');
  await page.getByRole('textbox', { name: 'Russian spoken words', exact: true }).fill('');
  await page.getByRole('button', { name: 'Edit in Spanish', exact: true }).last().click();
  await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  await expect(page.getByText('Complete both text fields', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Duplicate tile', exact: true })).toBeDisabled();
  expect((await savedBoard(page)).tiles).toEqual(original.tiles);
  await page.getByRole('button', { name: 'Edit in Russian', exact: true }).last().click();
  await expect(page.getByRole('textbox', { name: 'Russian words on the tile', exact: true })).toHaveValue('');
  await expect(page.getByRole('textbox', { name: 'Russian spoken words', exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.reload();
  if (!page.url().includes('/edit')) await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
  await openRussianTile(page);
  await expect(page.getByRole('textbox', { name: 'Russian spoken words', exact: true })).toHaveValue(original.tiles[0].translations![0].speech);
  expect((await savedBoard(page)).tiles).toEqual(original.tiles);
  await page.getByRole('textbox', { name: 'Russian words on the tile', exact: true }).fill('');
  await page.getByRole('textbox', { name: 'Russian spoken words', exact: true }).fill('');
  await page.getByRole('button', { name: 'Edit in Spanish', exact: true }).last().click();
  await page.getByRole('button', { name: 'Edit in Russian', exact: true }).last().click();
  await page.getByRole('textbox', { name: 'Russian words on the tile', exact: true }).fill('Corrected label');
  await page.getByRole('textbox', { name: 'Russian spoken words', exact: true }).fill('Corrected words');
  await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  await expect.poll(async () => (await savedBoard(page)).tiles[0].translations.find((t: any) => t.language === 'ru-RU'))
    .toMatchObject({ label: 'Corrected label', speech: 'Corrected words', origin: 'manual' });
  await page.reload();
  const saved = await savedBoard(page);
  expect(saved.tiles[0].translations.find((t: any) => t.language === 'ru-RU')).toMatchObject({ label: 'Corrected label', speech: 'Corrected words', origin: 'manual' });
  expect(saved.tiles[0].translations.find((t: any) => t.language === 'es-ES')).toEqual(original.tiles[0].translations![1]);
  expect(saved.tiles[0]).toMatchObject({ label: original.tiles[0].label, speech: original.tiles[0].speech, language: original.tiles[0].language, illustration: original.tiles[0].illustration });
  expect(saved.tiles[1]).toEqual(original.tiles[1]);
});

for (const missing of [false, true]) test(`source collisions protect ${missing ? 'new' : 'newly corrected generated'} translations in the current draft`, async ({ page }) => {
  const original = await openTranslations(page, missing);
  await openRussianTile(page);
  await page.getByRole('button', { name: 'Edit in Spanish', exact: true }).last().click();
  await page.getByRole('textbox', { name: 'Spanish words on the tile', exact: true }).fill('Corrected label');
  await page.getByRole('textbox', { name: 'Spanish spoken words', exact: true }).fill('Corrected words');
  await page.getByRole('button', { name: 'Original words', exact: true }).last().click();
  await page.getByRole('button', { name: 'Change original language', exact: true }).click();
  await page.getByRole('button', { name: 'Choose tile language Spanish', exact: true }).click();
  for (const name of ['Save tile', 'Duplicate tile']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByText('Keep the original language and edit its translation instead', { exact: false })).toBeVisible();
    expect((await savedBoard(page)).tiles).toEqual(original.tiles);
  }
  await page.getByRole('textbox', { name: 'Language tag', exact: true }).fill('en-US');
  await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  await expect.poll(async () => (await savedBoard(page)).tiles[0].translations.find((t: any) => t.language === 'es-ES'))
    .toMatchObject({ label: 'Corrected label', speech: 'Corrected words', origin: 'manual' });
  await page.reload();
  expect((await savedBoard(page)).tiles[0].translations.find((t: any) => t.language === 'es-ES')).toMatchObject({ label: 'Corrected label', speech: 'Corrected words', origin: 'manual' });
});

test('manual source-language collisions refuse save and duplicate without hiding a saved correction', async ({ page }) => {
  const original = await openTranslations(page);
  await openRussianTile(page);
  await page.getByRole('button', { name: 'Original words', exact: true }).last().click();
  await page.getByRole('button', { name: 'Change original language', exact: true }).click();
  await page.getByRole('button', { name: 'Choose tile language Russian', exact: true }).click();
  await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  await expect(page.getByText('Keep the original language and edit its translation instead', { exact: false })).toBeVisible();
  expect((await savedBoard(page)).tiles).toEqual(original.tiles);
  await page.getByRole('button', { name: 'Duplicate tile', exact: true }).click();
  await expect(page.getByText('Keep the original language and edit its translation instead', { exact: false })).toBeVisible();
  expect((await savedBoard(page)).tiles).toEqual(original.tiles);
  await page.getByRole('textbox', { name: 'Language tag', exact: true }).fill('en-US');
  await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  expect((await savedBoard(page)).tiles).toEqual(original.tiles);
  await page.reload();
  if (!page.url().includes('/edit')) await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
  await openRussianTile(page);
  await expect(page.getByRole('textbox', { name: 'Russian spoken words', exact: true })).toHaveValue(original.tiles[0].translations![0].speech);
});

test('late TTS stays on its original key; failure and retry use the corrected input', async ({ page }) => {
  const wave = pcmToWav(Buffer.alloc(24000)); const id = createHash('sha256').update(wave).digest('hex');
  const requests: any[] = []; let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let fail = true;
  await page.route('**/api/speech', async route => {
    const input = route.request().postDataJSON();
    if (!['корова', 'коровушка'].includes(input.text)) return route.fulfill({ status: 503, json: { error: 'Use the device fallback for other words' } });
    requests.push(input);
    if (input.text === 'корова') await gate;
    if (input.text === 'коровушка' && fail) return route.fulfill({ status: 503, json: { error: 'Synthetic audio unavailable' } });
    await route.fulfill({ json: { ...input, id, cacheHit: false } });
  });
  await page.route('**/api/speech/*.wav', route => route.fulfill({ body: wave, contentType: 'audio/wav' }));
  await openTranslations(page);
  await openRussianTile(page);
  // AI languages start preparing saved words automatically; edited draft words still need preview/generation.
  await expect.poll(() => requests.length).toBe(1);
  await page.getByRole('textbox', { name: 'Russian spoken words', exact: true }).fill('коровушка');
  await page.getByRole('button', { name: 'Edit in Spanish', exact: true }).last().click(); release();
  await expect(page.getByRole('button', { name: 'Generate audio', exact: true })).toBeEnabled();
  await expect(page.getByRole('textbox', { name: 'Spanish spoken words', exact: true })).toHaveValue('vaca');
  await page.getByRole('button', { name: 'Edit in Russian', exact: true }).last().click();
  await page.getByRole('button', { name: 'Generate audio', exact: true }).click();
  await expect(page.getByText('Synthetic audio unavailable').first()).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Russian spoken words', exact: true })).toHaveValue('коровушка');
  fail = false; await page.getByRole('button', { name: 'Generate audio', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Regenerate audio', exact: true })).toBeEnabled();
  expect(requests.slice(-2)).toEqual([{ text: 'коровушка', language: 'ru-RU', regenerate: false }, { text: 'коровушка', language: 'ru-RU', regenerate: false }]);
  await page.getByRole('textbox', { name: 'Russian words on the tile', exact: true }).fill('Бурёнка');
  await expect(page.getByRole('button', { name: 'Regenerate audio', exact: true })).toBeEnabled();
});

test('source edits retain stale corrected text for review and incomplete variants cannot be saved', async ({ page }) => {
  await openTranslations(page);
  await openRussianTile(page);
  await page.getByRole('button', { name: 'Original words', exact: true }).last().click();
  await page.getByRole('textbox', { name: 'What it says', exact: true }).fill('Moo');
  await page.getByRole('button', { name: 'Edit in Russian', exact: true }).last().click();
  await expect(page.getByText('The original words changed.', { exact: false })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Russian spoken words', exact: true })).toHaveValue('корова');
  await expect(page.getByRole('button', { name: 'Generate audio', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  await openRussianTile(page);
  await page.getByRole('button', { name: 'Use reviewed translation', exact: true }).click();
  await page.getByRole('textbox', { name: 'Russian spoken words', exact: true }).fill('');
  await page.getByRole('button', { name: 'Edit in Spanish', exact: true }).last().click();
  await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  await expect(page.getByText('Complete both text fields', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Edit in Russian', exact: true }).last().click();
  await expect(page.getByRole('textbox', { name: 'Russian spoken words', exact: true })).toHaveValue('');
  await page.getByRole('textbox', { name: 'Russian spoken words', exact: true }).fill('коровушка');
  await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit tile Cow', exact: true })).toBeVisible();
});

for (const replace of [false, true]) test(`AI ${replace ? 'uses an explicitly reviewed replacement' : 'keeps a saved correction when replacement is declined'}`, async ({ page }) => {
  const board = await openTranslations(page);
  await page.route('**/api/boards/propose', route => route.fulfill({ json: { boardId: board.id, baseRevision: board.revision, proposal: { title: board.title, explanation: 'Updated the title and wording.', needsClarification: false, tiles: board.tiles.map(t => ({ existingId: t.id, label: t.label, speech: t.speech, language: t.language, emoji: '🐄', color: t.color, translations: t.languageMode === 'board' ? [{ language: 'ru-RU', label: 'Бурёнка', speech: 'бурёнка' }] : [] })) } } }));

  await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill('Improve this board');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review translation replacements', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Review translation replacements', exact: true }).click();
  await expect(page.getByText('Saved: Корова / корова', { exact: true })).toBeVisible();
  await expect(page.getByText('Proposed: Бурёнка / бурёнка', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: replace ? 'Use proposed translations' : 'Keep saved translations', exact: true }).click();
  await waitForAiTurn(page);
  await expect(page.getByRole('button', { name: 'Edit tile Cow', exact: true })).toBeVisible();
  expect((await savedBoard(page)).tiles[0].translations[0].speech).toBe(replace ? 'бурёнка' : 'корова');
});

test('AI source-language collisions are refused without replacing saved corrections', async ({ page }) => {
  const original = await openTranslations(page);
  await page.route('**/api/boards/propose', route => route.fulfill({ json: { boardId: original.id, baseRevision: original.revision, proposal: { title: original.title, explanation: 'Changed the source language.', needsClarification: false, tiles: original.tiles.map(tile => ({ existingId: tile.id, label: tile.languageMode === 'board' ? 'Бурёнка' : tile.label, speech: tile.languageMode === 'board' ? 'бурёнка' : tile.speech, language: tile.languageMode === 'board' ? 'ru-RU' : tile.language, emoji: '🐄', color: tile.color, translations: [] })) } } }));

  await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill('Change this board');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Keep the original language and edit its translation instead', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keep changes', exact: true })).toHaveCount(0);
  expect((await savedBoard(page)).tiles).toEqual(original.tiles);
});

test('direct play entry inherits Russian and returns with corrected speech while source labels stay enabled', async ({ page }) => {
  await openTranslations(page);
  await page.getByRole('button', { name: 'Play board', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cow', exact: true })).toBeVisible();
  await page.getByTestId('board-back').click();
  await openRussianTile(page);
  await page.getByRole('textbox', { name: 'Russian spoken words', exact: true }).fill('коровушка');
  await page.getByRole('button', { name: 'Listen to translation', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__spoken.at(-1))).toEqual({ text: 'коровушка', language: 'ru-RU' });
  await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  await page.getByRole('button', { name: 'Return to play', exact: true }).click();
  await page.getByRole('button', { name: 'Cow', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__spoken)).toEqual([{ text: 'коровушка', language: 'ru-RU' }, { text: 'коровушка', language: 'ru-RU' }]);
});

test('removing the selected language shows original words without deleting its correction', async ({ page }) => {
  const original = await openTranslations(page);
  await openBoardLanguages(page);
  await page.getByRole('checkbox', { name: 'Play language Russian', exact: true }).click();
  await page.getByRole('button', { name: 'Close Board languages', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit in Russian', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit tile Cow', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'What it says', exact: true })).toHaveValue('Cow');
  await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  expect((await savedBoard(page)).tiles[0].translations).toEqual(original.tiles[0].translations);
});

test('missing variants stay blank, drafts survive switching and cancelled translation results cannot replace a retry', async ({ page }) => {
  await openTranslations(page, true);
  await page.getByRole('button', { name: 'Edit tile Cow', exact: true }).click();
  await page.getByRole('button', { name: 'Edit in Spanish', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Spanish spoken words', exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Generate audio', exact: true })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Spanish words on the tile', exact: true }).fill('Borrador');
  await page.getByRole('button', { name: 'Edit in Russian', exact: true }).last().click();
  await page.getByRole('button', { name: 'Edit in Spanish', exact: true }).last().click();
  await expect(page.getByRole('textbox', { name: 'Spanish words on the tile', exact: true })).toHaveValue('Borrador');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let calls = 0;
  await page.route('**/api/boards/translate', async route => {
    const input = route.request().postDataJSON(); const call = ++calls;
    expect(input.tiles[0].targets).toEqual(['es-ES']);
    if (call === 1) await gate;
    if (call === 2) return route.fulfill({ status: 503, json: { error: 'Translation unavailable. Try again.' } });
    await route.fulfill({ json: { boardId: input.boardId, baseRevision: input.baseRevision, translations: [{ tileId: input.tiles[0].id, language: 'es-ES', label: call === 1 ? 'Obsoleto' : 'Vaca nueva', speech: call === 1 ? 'obsoleto' : 'vaca nueva' }] } }).catch(() => {});
  });
  await openBoardLanguages(page);
  await page.getByRole('button', { name: 'Close Board languages', exact: true }).click();
  await expect.poll(() => calls).toBe(1);
  await page.getByRole('button', { name: 'Cancel translations', exact: true }).click();
  await openBoardLanguages(page);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByText('Translation unavailable. Try again.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry translations', exact: true }).click();
  await expect.poll(async () => (await savedBoard(page)).tiles[0].translations.find((tile: any) => tile.language === 'es-ES')?.speech).toBe('vaca nueva');
  await expect(page.getByRole('button', { name: 'Edit tile Cow', exact: true })).toBeVisible();
  release();
  await expect.poll(async () => (await savedBoard(page)).tiles[0].translations.find((tile: any) => tile.language === 'es-ES')?.speech).toBe('vaca nueva');
  await expect(page.getByRole('button', { name: 'Edit tile Cow', exact: true })).toBeVisible();
  expect((await savedBoard(page)).tiles[0].translations.find((t: any) => t.language === 'ru-RU').speech).toBe('корова');
});

test('automatic translations keep stale corrections for review in their individual card', async ({ page }) => {
  await openTranslations(page, true);
  await openRussianTile(page);
  await page.getByRole('button', { name: 'Original words', exact: true }).last().click();
  await page.getByRole('textbox', { name: 'What it says', exact: true }).fill('Moo');
  await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  await page.route('**/api/boards/translate', route => {
    const input = route.request().postDataJSON();
    expect(input.tiles[0].targets).toEqual(['es-ES']);
    return route.fulfill({ json: { boardId: input.boardId, baseRevision: input.baseRevision, translations: [{ tileId: input.tiles[0].id, language: 'es-ES', label: 'Vaca', speech: 'muu' }] } });
  });
  await openBoardLanguages(page);
  await page.getByTestId('modal-backdrop').click({ position: { x: 4, y: 4 } });
  await expect.poll(async () => (await savedBoard(page)).tiles[0].translations.find((t: any) => t.language === 'es-ES')?.speech).toBe('muu');
  await openRussianTile(page);
  await expect(page.getByText('The original words changed.', { exact: false })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Russian spoken words', exact: true })).toHaveValue('корова');
  expect((await savedBoard(page)).tiles[0].translations.find((t: any) => t.language === 'ru-RU').speech).toBe('корова');
});

test('closing language choices prepares once and continues after leaving the editor', async ({ page }) => {
  await openTranslations(page, true);
  let calls = 0; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/boards/translate', async route => {
    const input = route.request().postDataJSON(); calls++;
    expect(input.tiles).toHaveLength(1);
    expect(input.tiles[0].targets).toEqual(['es-ES']);
    await gate;
    await route.fulfill({ json: { boardId: input.boardId, baseRevision: input.baseRevision, translations: [{ tileId: input.tiles[0].id, language: 'es-ES', label: 'Vaca', speech: 'vaca' }] } });
  });
  await openBoardLanguages(page);
  await page.getByRole('checkbox', { name: 'Play language Spanish', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Play language Spanish', exact: true }).click();
  expect(calls).toBe(0);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(() => calls).toBe(1);
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  release();
  await expect.poll(async () => (await savedBoard(page)).tiles[0].translations.find((value: any) => value.language === 'es-ES')?.speech).toBe('vaca');
  await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
  await openBoardLanguages(page);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Edit tile Cow', exact: true }).click();
  await page.getByRole('button', { name: 'Edit in Spanish', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Spanish words on the tile', exact: true })).toHaveValue('Vaca');
  expect(calls).toBe(1);
  expect((await savedBoard(page)).playLanguageSubset).toBeUndefined();
});

test('a failed save keeps the corrected board visible and retry persists it before reload', async ({ page }) => {
  await openTranslations(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put; (window as any).__failSave = true;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'state' && (window as any).__failSave) throw new DOMException('Synthetic storage failure', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await openRussianTile(page);
  await page.getByRole('textbox', { name: 'Russian spoken words', exact: true }).fill('коровушка');
  await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  await expect(page.getByText('Not saved — retry saving', { exact: true })).toBeVisible();
  await openRussianTile(page);
  await expect(page.getByRole('textbox', { name: 'Russian spoken words', exact: true })).toHaveValue('коровушка');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => { (window as any).__failSave = false; });
  await page.getByRole('button', { name: 'Retry saving', exact: true }).click();
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
  await page.reload();
  if (!page.url().includes('/edit')) await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
  await openRussianTile(page);
  await expect(page.getByRole('textbox', { name: 'Russian spoken words', exact: true })).toHaveValue('коровушка');
});
