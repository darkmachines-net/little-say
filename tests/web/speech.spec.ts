/**
 * @file Exercises generated-audio controls, language-specific clips, and fallback behavior in the
 * browser.
 */

import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { pcmToWav } from '../../apps/server/src/synthesis';
import { openExistingLibrary } from './existingLibrary';

test('generates from draft text and language, regenerates, persists offline, and falls back on playback failure', async ({ page, context }) => {
  const pcm = Buffer.alloc(24000);
  for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 24000 * 440 * 2 * Math.PI) * 400), i * 2);
  const wave = pcmToWav(pcm);
  const id = createHash('sha256').update(wave).digest('hex');
  const requests: { text: string; language: string; regenerate: boolean }[] = [];
  await page.addInitScript(() => {
    const w = window as any;
    w.__audioPlayed = []; w.__spoken = []; w.__failAudio = false;
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      w.__audioPlayed.push(this.src);
      return w.__failAudio ? Promise.reject(new Error('Audio unavailable')) : original.call(this);
    };
    w.SpeechSynthesisUtterance = class { constructor(public text: string) {} };
    Object.defineProperty(w, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [{ voiceURI: 'test-en', name: 'English', lang: 'en-US', localService: true }, { voiceURI: 'test-ru', name: 'Russian', lang: 'ru-RU', localService: true }],
      speak: (utterance: any) => { w.__spoken.push({ text: utterance.text, language: utterance.lang }); setTimeout(() => utterance.onend?.(), 10); },
      cancel() {}, addEventListener() {}, removeEventListener() {},
    } });
    Element.prototype.requestFullscreen = async () => {};
  });
  await page.route('**/api/speech', async route => {
    const input = route.request().postDataJSON(); requests.push(input);
    await route.fulfill({ json: { text: input.text, language: input.language, id, cacheHit: !input.regenerate } });
  });
  await page.route('**/api/speech/*.wav', route => route.fulfill({ body: wave, contentType: 'audio/wav' }));
  await openExistingLibrary(page);
  await page.getByRole('button', { name: 'Edit Our family', exact: true }).click();
  await page.getByRole('button', { name: 'Edit tile Babushka', exact: true }).click();
  await page.getByRole('textbox', { name: 'What it says', exact: true }).fill('Привет, бабушка');
  await page.getByRole('button', { name: 'Generate audio', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Regenerate audio', exact: true })).toBeEnabled();
  expect(requests).toContainEqual({ text: 'Привет, бабушка', language: 'ru-RU', regenerate: false });
  await page.getByRole('button', { name: 'Listen to this tile', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__audioPlayed.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).__spoken)).toEqual([]);
  await page.getByRole('button', { name: 'Regenerate audio', exact: true }).click();
  await expect.poll(() => requests.some(input => input.text === 'Привет, бабушка' && input.regenerate)).toBe(true);
  await expect(page.getByRole('button', { name: 'Regenerate audio', exact: true })).toBeEnabled();
  // The language is part of the lookup even while the editor has unsaved changes.
  await page.getByRole('textbox', { name: 'Language tag', exact: true }).fill('en-US');
  await expect(page.getByRole('button', { name: 'Generate audio', exact: true })).toBeEnabled();
  await page.getByRole('textbox', { name: 'Language tag', exact: true }).fill('ru-RU');
  await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save tile', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit tile Babushka', exact: true }).click();
  await expect(page.getByText('Edit tile', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Regenerate audio', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Regenerate audio', exact: true }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300); // Let the native-style modal fade finish for its screenshot.
  await page.screenshot({ path: 'artifacts/screenshots/tile-generated-audio.png' });
  await page.getByRole('button', { name: 'Close Edit tile', exact: true }).click();
  await page.getByRole('button', { name: 'Play board', exact: true }).click();
  await expect(page.getByTestId('play-board')).toBeVisible(); // Session save is async.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true); await page.reload();
  await expect(page.getByTestId('play-board')).toBeVisible();
  // Wait for the independent audio index to restore, then use real HTML audio.
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('little-say', 2); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    return new Promise<boolean>(resolve => {
      const request = db.transaction('speech').objectStore('speech').get(JSON.stringify(['Привет, бабушка', 'ru-RU']));
      request.onsuccess = () => { db.close(); resolve(Boolean(request.result)); };
    });
  })).toBe(true);
  await page.getByRole('button', { name: 'Babushka', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__audioPlayed.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).__audioPlayed[0])).toMatch(/^blob:/);
  expect(await page.evaluate(() => (window as any).__spoken)).toEqual([]);
  await page.waitForTimeout(700); // The real fixture is 0.5 seconds long.
  await page.evaluate(() => { (window as any).__failAudio = true; });
  await page.getByRole('button', { name: 'Babushka', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__spoken)).toEqual([{ text: 'Привет, бабушка', language: 'ru-RU' }]);
});

test('board creation does not wait for background audio and stale generation cannot replace edited words', async ({ page }) => {
  const wave = pcmToWav(Buffer.alloc(100));
  const id = createHash('sha256').update(wave).digest('hex');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/speech', async route => {
    const input = route.request().postDataJSON();
    await gate;
    await route.fulfill({ json: { text: input.text, language: input.language, id, cacheHit: false } }).catch(() => {});
  });
  await page.route('**/api/speech/*.wav', route => route.fulfill({ body: wave, contentType: 'audio/wav' }));
  await page.route('**/api/boards/propose', route => route.fulfill({ json: {
    boardId: null, baseRevision: null, proposal: { title: 'New sounds', explanation: 'A new word.', needsClarification: false,
      tiles: [{ existingId: null, label: 'Owl', speech: 'Owl', language: 'en-US', emoji: '🦉', color: 'sage' }] },
  } }));
  await openExistingLibrary(page);
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill('Owl');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByRole('button', { name: 'Continue with AI', exact: true }).click();
  await page.getByRole('button', { name: 'Use this board', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit tile Owl', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit tile Owl', exact: true }).click();
  await page.getByRole('textbox', { name: 'What it says', exact: true }).fill('Hoot');
  await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  release();
  await page.getByRole('button', { name: 'Edit tile Owl', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'What it says', exact: true })).toHaveValue('Hoot');
  await expect(page.getByRole('button', { name: 'Regenerate audio', exact: true })).toBeEnabled();
  await expect(page.getByRole('textbox', { name: 'What it says', exact: true })).toHaveValue('Hoot');
});
