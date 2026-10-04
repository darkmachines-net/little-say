/**
 * @file Captures picture controls and saved construction boards in an isolated Chromium session.
 * Requires a web build and artifacts from eval:pictures --generate; never invokes paid APIs.
 */

import { chromium, expect, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { pictureAssetIdSchema, type Library } from '@little-say/core';
import { createServer } from '../apps/server/src/app';
import { starterLibrary } from '../tests/fixtures/library';

const report = z.object({ model: z.string(), results: z.array(z.object({ label: z.string(), assetId: pictureAssetIdSchema })).length(6) }).parse(JSON.parse(await readFile('artifacts/picture-evaluation/color/report.json', 'utf8')));
const images = await Promise.all(report.results.map(async (result, index) => {
  const bytes = await readFile(`artifacts/picture-evaluation/color/${index}.png`);
  if (createHash('sha256').update(bytes).digest('hex') !== result.assetId) throw new Error(`Evaluation picture ${index} failed its digest check.`);
  return { id: result.assetId, bytes: [...bytes] };
}));
const output = resolve('artifacts/screenshots/card-pictures');
await mkdir(output, { recursive: true });
const saved = starterLibrary();
saved.settings.autoSpeech = false;
saved.boards = [{ ...saved.boards[0], id: 'construction-qa', title: 'Construction vehicles', picturePolicy: { mode: 'auto', style: 'color', consistent: true }, tiles: report.results.map((result, index) => ({ ...saved.boards[0].tiles[index], id: `vehicle-${index}`, label: result.label, speech: result.label, illustration: { kind: 'generated', assetId: result.assetId, description: result.label, style: 'color', model: report.model } })) }];

async function seed(page: Page, value: Library) {
  await page.goto(address);
  await expect(page.getByRole('heading', { name: 'Choose your languages', exact: true })).toBeVisible();
  await page.evaluate(async ({ value, images }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('little-say'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['state', 'pictures'], 'readwrite');
      tx.objectStore('state').put(value, 'library');
      for (const image of images) tx.objectStore('pictures').put(new Blob([new Uint8Array(image.bytes)], { type: 'image/png' }), image.id);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    }); db.close();
  }, { value, images });
  await page.reload();
  await expect(page.getByText('Your soundboards', { exact: true })).toBeVisible();
}

async function capture(page: Page, name: string) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(image => image.decode().catch(() => {})));
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await page.screenshot({ path: resolve(output, `${name}.png`) });
}

const app = await createServer({ provider: null, webRoot: resolve('apps/mobile/dist') });
const address = await app.listen({ port: 0, host: '127.0.0.1' });
const browser = await chromium.launch();
try {
  for (const [name, width, height] of [['tablet', 820, 1180], ['phone', 430, 932]] as const) {
    for (const emojiOnly of [true, false]) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      const value = structuredClone(saved);
      if (emojiOnly) value.boards[0].tiles.forEach((tile, index) => { tile.illustration = { kind: 'emoji', emoji: ['🚚', '🚚', '🚜', '🚜', '🏗️', '🚜'][index] }; });
      await seed(page, value);
      await page.getByRole('button', { name: 'Play Construction vehicles', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Dump truck', exact: true })).toBeVisible();
      await expect(page.getByTestId('card-picture')).toHaveCount(emojiOnly ? 0 : 6);
      await expect(page.getByText('Picture unavailable', { exact: true })).toHaveCount(0);
      await capture(page, `${emojiOnly ? 'emoji-comparison' : 'generated-board'}-${name}`);
      await context.close();
    }
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    await seed(page, saved);
    await page.getByRole('button', { name: 'Edit Construction vehicles', exact: true }).click();
    await page.getByRole('button', { name: 'Pictures', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Board pictures', exact: true })).toBeVisible();
    await expect(page.getByTestId('card-picture')).toHaveCount(12);
    await capture(page, `board-controls-${name}`);
    await page.getByRole('button', { name: 'Close Board pictures', exact: true }).click();
    await page.getByRole('button', { name: 'Edit tile Excavator', exact: true }).click();
    await page.getByRole('button', { name: 'Picture options', exact: true }).click();
    await page.getByRole('textbox', { name: 'Describe this picture', exact: true }).fill('An excavator with tracks and a long digging arm');
    await page.getByRole('textbox', { name: 'Describe this picture', exact: true }).scrollIntoViewIfNeeded();
    await capture(page, `card-controls-${name}`);
    await page.getByRole('button', { name: 'Close Edit tile', exact: true }).click();
    await page.getByRole('button', { name: 'Edit with AI', exact: true }).click();
    await page.getByRole('button', { name: 'Picture settings', exact: true }).click();
    await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill('Use library pictures in black and white. Keep the excavator picture.');
    await page.getByRole('button', { name: 'Library only', exact: true }).click();
    await page.getByRole('button', { name: 'Black and white', exact: true }).click();
    await capture(page, `prompt-controls-${name}`);
    await context.close();
  }
  console.log(`Saved picture evidence to ${output}. No AI calls were made.`);
} finally { await browser.close(); await app.close(); }
