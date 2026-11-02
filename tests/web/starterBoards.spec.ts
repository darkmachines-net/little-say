/** @file Verifies registration opens playable, editable starter boards without AI generation and preserves edits/deletions across login. */

import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

test('new accounts immediately play, edit, and retain their three starter boards before verification', async ({ page }) => {
  const email = `${randomUUID()}@example.test`, password = 'a starter board passphrase';
  const generation: string[] = [];
  page.on('request', request => { if (/\/api\/(boards\/propose|pictures\/)/.test(request.url())) generation.push(request.url()); });
  await page.route('**/api/speech', route => route.fulfill({ status: 503, json: { error: 'Use device speech' } }));
  await page.addInitScript(() => {
    const w = window as any; w.__spoken = [];
    w.SpeechSynthesisUtterance = class {
      text: string; lang = ''; onstart: any;
      /** Record the requested text for the device-speech fallback assertion. */
      constructor(text: string) { this.text = text; }
    };
    Object.defineProperty(w, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [{ voiceURI: 'en-US', name: 'English', lang: 'en-US', localService: true }],
      speak: (utterance: any) => { w.__spoken.push({ text: utterance.text, language: utterance.lang }); utterance.onstart?.(); },
      cancel() {}, addEventListener() {}, removeEventListener() {},
    } });
    Element.prototype.requestFullscreen = async () => {};
  });
  await page.goto('/app');
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByTestId('library-board')).toHaveCount(3);
  for (const title of ['Farm Animals', 'Rainbow', 'Shapes']) {
    await expect(page.getByRole('button', { name: `Play ${title}`, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: `Edit ${title}`, exact: true })).toBeVisible();
  }
  expect((await page.request.get('/api/account/backup')).status()).toBe(403);
  await page.getByRole('button', { name: 'Play Farm Animals', exact: true }).click();
  for (const label of ['Horse', 'Pig', 'Goat', 'Chicken', 'Sheep', 'Cow']) await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Horse', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__spoken.at(-1))).toEqual({ text: 'Horse', language: 'en-US' });
  await page.getByRole('button', { name: 'Back to editor', exact: true }).click();
  await page.getByRole('textbox', { name: 'Board title', exact: true }).fill('My farm');
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await page.getByRole('button', { name: 'More options for Shapes', exact: true }).click();
  await page.getByRole('button', { name: 'Delete board', exact: true }).click();
  await page.getByRole('button', { name: 'Delete board', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByTestId('library-board')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Play My farm', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('library-board')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Play My farm', exact: true })).toBeVisible();
  expect(generation).toEqual([]);
});
