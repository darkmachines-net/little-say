/** @file Captures deterministic live-workspace stages using retained real evaluation PNGs and mocked timing; makes no AI calls. */

import { chromium, expect, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import { pictureAssetIdSchema, type PictureJobRequest } from '@little-say/core';
import { createServer } from '../apps/server/src/app';
import { starterLibrary } from '../tests/fixtures/library';

const report = z.object({ model: z.string(), results: z.array(z.object({ label: z.string(), assetId: pictureAssetIdSchema })).length(6) }).parse(JSON.parse(await readFile('artifacts/picture-evaluation/color/report.json', 'utf8')));
const images = await Promise.all(report.results.map(async (result, index) => {
  const bytes = await readFile(`artifacts/picture-evaluation/color/${index}.png`);
  if (createHash('sha256').update(bytes).digest('hex') !== result.assetId) throw new Error(`Picture ${index} failed its digest check.`);
  return { ...result, bytes };
}));
const output = resolve('artifacts/screenshots/board-workspace');
await mkdir(output, { recursive: true });
const colors = ['butter', 'peach', 'sky', 'sage', 'lilac', 'rose'] as const;
const policy = { mode: 'auto', style: 'color', consistent: true };
const proposal = { title: 'Construction vehicles', explanation: 'Here are your six construction vehicles. Their pictures will appear on the board as they are ready.', needsClarification: false, picturePolicy: policy, tiles: images.map((image, index) => ({ existingId: null, label: image.label, speech: image.label, language: 'en-US', emoji: ['🚚', '🚚', '🚜', '🚜', '🏗️', '🚜'][index], color: colors[index] })) };
const app = await createServer({ provider: null, webRoot: resolve(process.env.WEB_ROOT ?? 'apps/mobile/dist') });
const address = await app.listen({ port: 0, host: '127.0.0.1' });
const browser = await chromium.launch();

async function setup(page: Page, fallback = false) {
  await page.goto(new URL('/app', address).href);
  await expect(page.getByRole('heading', { name: 'Choose your languages', exact: true })).toBeVisible();
  const library = starterLibrary(); library.settings.aiConsent = true; library.settings.autoSpeech = false; library.settings.autoImages = false;
  await page.evaluate(async library => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('little-say'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put(library, 'library'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
  }, library);
  await page.reload();
  const jobs = new Map<string, PictureJobRequest>(); const ready = new Set<string>(); let turns = 0;
  await page.route('**/api/health', route => route.fulfill({ json: { pictures: { version: 1 } } }));
  await page.route('**/api/boards/propose', route => route.fulfill({ json: { boardId: null, baseRevision: null, proposal: ++turns === 1 ? proposal : { ...proposal, explanation: 'Which vehicle would you like to change? Your current board stays on the canvas while we decide.', needsClarification: true, tiles: [] } } }));
  await page.route('**/api/pictures/analyze', route => { const input = route.request().postDataJSON(); return route.fulfill({ json: { tiles: input.tiles.map((tile: any) => ({ id: tile.id, emoji: tile.emoji, concept: { description: tile.label, searchTerms: [tile.label], features: ['distinct vehicle structure'], emojiAccurate: false } })) } }); });
  await page.route('**/api/pictures/jobs', route => {
    const job = route.request().postDataJSON() as PictureJobRequest; jobs.set(job.requestId, job);
    return route.fulfill({ json: { id: job.requestId, draftId: job.draftId, tileId: job.tileId, state: fallback ? 'complete' : 'working', ...(fallback ? { result: { kind: 'unresolved', reason: 'Image service unavailable.' } } : {}) } });
  });
  await page.route('**/api/pictures/jobs/*', route => {
    const id = route.request().url().split('/').at(-1)!; const job = jobs.get(id)!;
    const image = images.find(image => image.label === job.concept.description)!;
    return route.fulfill({ json: { id, draftId: job.draftId, tileId: job.tileId, state: ready.has(image.label) ? 'complete' : 'working', ...(ready.has(image.label) ? { result: { kind: 'generated', assetId: image.assetId, style: 'color', description: image.label, model: report.model } } : {}) } });
  });
  await page.route('**/api/pictures/assets/*.png', route => { const image = images.find(image => route.request().url().endsWith(`${image.assetId}.png`))!; return route.fulfill({ body: image.bytes, contentType: 'image/png' }); });
  await page.route('**/api/pictures/review', route => route.fulfill({ json: { rejected: [] } }));
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill('Construction vehicles including an excavator, dump truck, and concrete truck, with three others.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  return ready;
}

async function capture(page: Page, name: string) {
  // Allow the finite native-web modal fade to settle while leaving picture pulses running.
  await page.waitForTimeout(400);
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode().catch(() => {}))); await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
  await page.screenshot({ path: resolve(output, `${name}.png`) });
}

try {
  for (const [name, width, height] of [['desktop', 1280, 900], ['tablet', 820, 1180], ['phone', 430, 932]] as const) {
    // Fixture responses must stay visible to Playwright instead of being handled by the offline worker.
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'no-preference', serviceWorkers: 'block' });
    const page = await context.newPage(); const ready = await setup(page);
    await expect(page.getByTestId('picture-active-animation')).toHaveCount(2);
    ready.add(images[0].label); ready.add(images[1].label);
    await expect(page.getByTestId('ai-draft').getByTestId('card-picture')).toHaveCount(2);
    await expect(page.getByTestId('picture-active-animation')).toHaveCount(2);
    await capture(page, `progress-${name}`);
    if (name === 'desktop') { await page.getByRole('button', { name: 'Picture settings', exact: true }).click(); await capture(page, 'settings-during-work'); await page.getByRole('button', { name: 'Done', exact: true }).click(); }
    images.forEach(image => ready.add(image.label));
    await expect(page.getByRole('button', { name: 'Use this board', exact: true })).toBeEnabled();
    await expect(page.getByTestId('ai-draft').getByTestId('card-picture')).toHaveCount(6);
    await capture(page, `ready-${name}`);
    await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill('Can we change one of these vehicles?');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.getByTestId('ai-draft')).toContainText('Waiting for your answer');
    await capture(page, `clarification-${name}`);
    await context.close();
    const fallbackContext = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' }); const fallbackPage = await fallbackContext.newPage();
    await setup(fallbackPage, true);
    await expect(fallbackPage.getByRole('button', { name: 'Use this board', exact: true })).toBeEnabled();
    await expect(fallbackPage.getByTestId('picture-summary')).toContainText('closest emoji for 6 cards');
    await capture(fallbackPage, `fallback-${name}`);
    await fallbackContext.close();
  }
  console.log(`Saved 13 workspace captures to ${output}. No AI calls were made; timing and responses were controlled fixtures.`);
} finally { await browser.close(); await app.close(); }
