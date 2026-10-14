/** @file Exercises language-first onboarding, generated starter drafts, retries, and setup persistence. */

import { expect, test, type Page } from '@playwright/test';
import { type ProposalRequest, type StarterTopic } from '../../packages/core/src/schema';

const words = {
  farm: { en: ['Cow', 'Sheep', 'Horse', 'Pig', 'Chicken', 'Duck'], fr: ['Vache', 'Mouton', 'Cheval', 'Cochon', 'Poulet', 'Canard'], es: ['Vaca', 'Oveja', 'Caballo', 'Cerdo', 'Pollo', 'Pato'] },
  everyday: { en: ['More', 'Water', 'Help', 'All done', 'Eat', 'Love you'], fr: ['Encore', 'Eau', 'Aide', 'Fini', 'Manger', 'Je t’aime'], es: ['Más', 'Agua', 'Ayuda', 'Terminé', 'Comer', 'Te quiero'] },
  family: { en: ['Mother', 'Father', 'Grandmother', 'Grandfather', 'Sister', 'Brother'], fr: ['Mère', 'Père', 'Grand-mère', 'Grand-père', 'Sœur', 'Frère'], es: ['Madre', 'Padre', 'Abuela', 'Abuelo', 'Hermana', 'Hermano'] },
};
function fixture(request: ProposalRequest) {
  const topic: StarterTopic = request.prompt.includes('cow, sheep') ? 'farm' : request.prompt.includes('more, water') ? 'everyday' : 'family';
  const profile = request.languageProfile!;
  const labels = (tag: string) => words[topic][tag.split('-')[0] as 'en' | 'fr' | 'es'];
  const title = ({ farm: 'Animaux', everyday: 'Mes mots', family: 'Famille' })[topic];
  return { topic, envelope: { boardId: null, baseRevision: null, proposal: { title, explanation: 'Six starter cards.', needsClarification: false, playLanguages: profile.languages, tiles: labels(profile.defaultLanguage).map((label, i) => ({ existingId: null, label, speech: label, language: profile.defaultLanguage, emoji: '⭐', color: 'sage', languageMode: profile.languages.length > 1 ? 'board' : 'fixed', translations: profile.languages.filter(tag => tag !== profile.defaultLanguage).map(language => ({ language, label: labels(language)[i], speech: labels(language)[i] })) })) } } };
}
async function readLibrary(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('little-say'); request.onsuccess = () => resolve(request.result); });
    const value = await new Promise<any>(resolve => { const request = db.transaction('state').objectStore('state').get('library'); request.onsuccess = () => resolve(request.result); });
    db.close(); return value;
  });
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any; w.__spoken = [];
    w.SpeechSynthesisUtterance = class { text = ''; lang = ''; onstart: any; constructor(text: string) { this.text = text; } };
    Object.defineProperty(w, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => ['en-US', 'fr-FR', 'es-ES'].map(lang => ({ voiceURI: lang, name: lang, lang, localService: true })),
      speak: (utterance: any) => { w.__spoken.push({ text: utterance.text, language: utterance.lang }); utterance.onstart?.(); },
      cancel() {}, addEventListener() {}, removeEventListener() {},
    } });
    Element.prototype.requestFullscreen = async () => {};
  });
  await page.goto('/app');
  await page.getByRole('button', { name: 'Continue without an account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose your languages', exact: true })).toBeVisible();
});

test('first-time setup generates chosen languages, resumes partial success, and starts audio after completion', async ({ page }) => {
  const attempts: Partial<Record<StarterTopic, number>> = {};
  let active = 0, peak = 0;
  await page.route('**/api/boards/propose', async route => {
    const input = route.request().postDataJSON();
    expect(input.languageProfile).toEqual({ languages: ['es-ES', 'fr-FR'], defaultLanguage: 'fr-FR' });
    const { topic, envelope } = fixture(input); attempts[topic] = (attempts[topic] ?? 0) + 1;
    active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 80)); active--;
    return topic === 'family' && attempts.family === 1 ? route.fulfill({ status: 503, json: { error: 'Connection interrupted. Retry this board.' } }) : route.fulfill({ json: envelope });
  });
  let releaseAudio!: () => void; let audioRequests = 0;
  const audioGate = new Promise<void>(resolve => { releaseAudio = resolve; });
  await page.route('**/api/speech', async route => { audioRequests++; await audioGate; return route.fulfill({ status: 503, json: { error: 'Use device speech for this test' } }); });
  await page.getByRole('button', { name: 'Add device language Spanish', exact: true }).click();
  await page.getByRole('button', { name: 'Add device language French', exact: true }).click();
  await page.getByRole('button', { name: 'Remove device language English', exact: true }).click();
  await page.getByRole('button', { name: 'Default language French', exact: true }).click();
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.getByRole('heading', { name: 'Choose your languages', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/screenshots/first-time-languages.png' });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Generate starter boards', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Use 2 ready boards', exact: true })).toBeVisible();
  expect(audioRequests).toBe(0); expect(peak).toBeLessThanOrEqual(2);
  expect((await readLibrary(page)).setup.drafts).toHaveLength(2);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your first boards', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry missing boards', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open my boards', exact: true })).toBeEnabled();
  expect(attempts).toEqual({ farm: 1, everyday: 1, family: 2 });
  await page.screenshot({ path: 'artifacts/screenshots/first-time-boards-ready.png' });
  await page.getByRole('button', { name: 'Open my boards', exact: true }).click();
  await expect(page.getByText('Your soundboards', { exact: true })).toBeVisible();
  await expect.poll(() => audioRequests).toBeGreaterThan(0);
  releaseAudio();
  const saved = await readLibrary(page);
  expect(saved.setup).toBeUndefined(); expect(saved.boards).toHaveLength(3);
  expect(saved.boards.every((board: any) => JSON.stringify(board.playLanguages) === JSON.stringify(['fr-FR', 'es-ES']))).toBe(true);
  await page.getByRole('button', { name: 'Play Animaux', exact: true }).click();
  await page.getByRole('button', { name: 'Vache', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__spoken.at(-1))).toEqual({ text: 'Vache', language: 'fr-FR' });
  await page.getByRole('button', { name: 'Play in Spanish', exact: true }).click();
  await page.getByRole('button', { name: 'Vaca', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__spoken.at(-1))).toEqual({ text: 'Vaca', language: 'es-ES' });
  await page.reload();
  await expect(page.getByTestId('play-board')).toBeVisible();
  expect(attempts).toEqual({ farm: 1, everyday: 1, family: 2 });
});

test('offline setup can save a regional preference and start empty without English sample boards', async ({ page, context }) => {
  await page.getByRole('textbox', { name: 'Another device language tag', exact: true }).fill('es-MX');
  await page.getByRole('button', { name: 'Add language', exact: true }).click();
  await page.getByRole('button', { name: 'Remove device language English', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your first boards', exact: true })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await context.setOffline(true); await page.reload();
  await page.getByRole('button', { name: 'Generate starter boards', exact: true }).click();
  await expect(page.getByText('Cannot reach Little Say.', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Start without starter boards', exact: true }).click();
  await expect(page.getByText('No boards yet', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('No boards yet', { exact: true })).toBeVisible();
  const saved = await readLibrary(page);
  expect(saved.setup).toBeUndefined(); expect(saved.boards).toEqual([]);
  expect(saved.settings.languageProfile).toEqual({ languages: ['es-MX'], defaultLanguage: 'es-MX' });
  await page.getByRole('button', { name: 'Build manually', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit tile Hola', exact: true })).toBeVisible();
});

test('setup waits for durable saves and retains generated drafts when final saving fails', async ({ page }) => {
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: any[]) { if ((window as any).__failWrites) throw new DOMException('Storage full', 'QuotaExceededError'); return original.apply(this, args as any); };
    (window as any).__failWrites = true;
  });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Setup could not be saved.', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Choose your languages', exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).__failWrites = false; });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Include Everyday words', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Include Family', exact: true }).click();
  let requests = 0;
  await page.route('**/api/boards/propose', route => { requests++; return route.fulfill({ json: fixture(route.request().postDataJSON()).envelope }); });
  await page.route('**/api/speech', route => route.fulfill({ status: 503, json: { error: 'Device speech test' } }));
  await page.getByRole('button', { name: 'Generate starter boards', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open my boards', exact: true })).toBeEnabled();
  await page.evaluate(() => { (window as any).__failWrites = true; });
  await page.getByRole('button', { name: 'Open my boards', exact: true }).click();
  await expect(page.getByText('Setup could not be saved.', { exact: false })).toBeVisible();
  expect((await readLibrary(page)).setup.drafts).toHaveLength(1);
  await page.reload();
  await page.getByRole('button', { name: 'Open my boards', exact: true }).click();
  await expect(page.getByText('Your soundboards', { exact: true })).toBeVisible();
  expect(requests).toBe(1); expect((await readLibrary(page)).boards).toHaveLength(1);
});
