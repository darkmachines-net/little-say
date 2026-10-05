/** @file Captures manual and conversational entry points plus first-send feedback against a built app; uses local fixtures without AI calls. */

import { chromium, expect, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createServer } from '../apps/server/src/app';
import { starterLibrary } from '../tests/fixtures/library';

const before = process.argv.includes('--before');
const output = resolve(`artifacts/screenshots/creation-entry/${before ? 'before' : 'after'}`);
await mkdir(output, { recursive: true });
const app = await createServer({ provider: null, webRoot: resolve(process.env.WEB_ROOT ?? 'apps/mobile/dist') });
const address = await app.listen({ port: 0, host: '127.0.0.1' });
const browser = await chromium.launch();

async function capture(page: Page, name: string) {
  await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
  await page.screenshot({ path: resolve(output, `${name}.png`) });
}

try {
  for (const [name, width, height] of [['desktop', 1280, 900], ['phone', 390, 844]] as const) {
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(new URL('/app', address).href);
    await expect(page.getByRole('heading', { name: 'Choose your languages', exact: true })).toBeVisible();
    const library = starterLibrary(); library.settings.aiConsent = false; library.settings.autoSpeech = false;
    await page.evaluate(async library => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('little-say'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      await new Promise<void>((resolve, reject) => { const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put(library, 'library'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
    }, library);
    await page.reload();
    await expect(page.getByText('Your soundboards', { exact: true })).toBeVisible();
    await capture(page, `boards-${name}`);
    await page.route('**/api/health', route => route.fulfill({ json: { pictures: { version: 1 } } }));
    let turns = 0;
    await page.route('**/api/boards/propose', route => {
      const added = ++turns > 1;
      const labels = added ? ['Cow', 'Sheep', 'Horse', 'Excavator'] : ['Cow', 'Sheep', 'Horse', 'Pig', 'Chicken', 'Goat'];
      const emoji = added ? ['🐄', '🐑', '🐎', '🚜'] : ['🐄', '🐑', '🐎', '🐖', '🐔', '🐐'];
      return route.fulfill({ json: { boardId: null, baseRevision: null, proposal: { title: added ? 'Animals and an excavator' : 'Farm animals', explanation: added ? 'The animals keep their emoji. I’m finding a clearer picture for the excavator.' : 'Here are six farm animals.', needsClarification: false, picturePolicy: { mode: 'auto', style: 'color', consistent: true }, tiles: labels.map((label, index) => ({ existingId: null, label, speech: label, language: 'en-US', emoji: emoji[index], color: ['sage', 'peach', 'sky', 'butter', 'rose', 'lilac'][index] })) } } });
    });
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/pictures/analyze', async route => { await pending; const input = route.request().postDataJSON(); await route.fulfill({ json: { tiles: input.tiles.map((tile: any) => ({ id: tile.id, emoji: tile.emoji, concept: { description: tile.label, searchTerms: [tile.label], features: [], emojiAccurate: tile.label !== 'Excavator' } })) } }).catch(() => {}); });
    await page.getByRole('button', { name: 'New board', exact: true }).click();
    await expect(page.getByTestId('ai-conversation')).toBeVisible();
    await capture(page, `conversation-${name}`);
    await page.getByRole('button', { name: '🐾 Farm animals', exact: true }).click();
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    if (before) await expect(page.getByRole('button', { name: 'Continue with AI', exact: true })).toBeVisible();
    else await expect(page.getByTestId('ai-working')).toContainText('Choosing pictures for your cards…');
    await capture(page, `first-send-${name}`);
    release();
    if (!before) {
      await expect(page.getByRole('button', { name: 'Use this board', exact: true })).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Create matching AI illustrations', exact: true })).toHaveCount(0);
      await capture(page, `emoji-ready-${name}`);
      const report = JSON.parse(await readFile('artifacts/picture-evaluation/color/report.json', 'utf8'));
      const index = report.results.findIndex((result: any) => result.label === 'Excavator');
      const picture = report.results[index]; const bytes = await readFile(`artifacts/picture-evaluation/color/${index}.png`);
      if (createHash('sha256').update(bytes).digest('hex') !== picture.assetId) throw new Error('Evidence asset failed digest verification.');
      let job: any; let phase = 'finding'; let ready = false;
      const status = () => ({ id: job.requestId, draftId: job.draftId, tileId: job.tileId, state: ready ? 'complete' : 'working', phase, ...(ready ? { result: { kind: 'generated', assetId: picture.assetId, style: 'color', description: 'Excavator', model: report.model } } : {}) });
      await page.route('**/api/pictures/jobs', route => { job = route.request().postDataJSON(); return route.fulfill({ json: status() }); });
      await page.route('**/api/pictures/jobs/*', route => route.fulfill({ json: status() }));
      await page.route('**/api/pictures/assets/*.png', route => route.fulfill({ body: bytes, contentType: 'image/png' }));
      await page.route('**/api/pictures/review', route => route.fulfill({ json: { rejected: [] } }));
      await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill('Keep cow, sheep and horse, and add an excavator');
      await page.getByRole('button', { name: 'Send message', exact: true }).click();
      await expect(page.getByText('Finding a picture', { exact: true })).toBeVisible();
      await capture(page, `gap-library-search-${name}`);
      phase = 'generating';
      await expect(page.getByText('Generating illustration', { exact: true })).toBeVisible();
      await capture(page, `gap-generating-${name}`);
      ready = true;
      await expect(page.getByRole('button', { name: 'Use this board', exact: true })).toBeEnabled();
      await expect(page.getByTestId('ai-draft').getByTestId('card-picture')).toHaveCount(1);
      await capture(page, `gap-ready-${name}`);
    }
    await context.close();
  }
  console.log(`Saved ${before ? 'six baseline' : 'fourteen updated'} captures to ${output}. No AI calls were made.`);
} finally { await browser.close(); await app.close(); }
