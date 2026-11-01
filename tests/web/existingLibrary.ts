/** @file Signs into isolated accounts, seeds libraries ready at the dashboard action, and exercises shared and per-card languages. */

import { openSignedInApp } from './accountFixture';
import { starterLibrary } from '../fixtures/library';
import { expect, type Page } from '@playwright/test';
import { type Library } from '@little-say/core';

/** Search directly for a named language or regional tag and choose its dropdown result. */
export async function addUserLanguage(page: Page, search: string, option = search) {
  await page.getByRole('textbox', { name: 'Add a language', exact: true }).fill(search);
  await page.getByRole('button', { name: `Add language ${option}`, exact: true }).click();
}

/** Reveal removal controls if needed, then remove the named selected language. */
export async function removeUserLanguage(page: Page, name: string) {
  const edit = page.getByRole('button', { name: 'Edit languages', exact: true });
  if (await edit.isVisible()) await edit.click();
  await page.getByRole('button', { name: `Remove language ${name}`, exact: true }).click();
}

/** Change legacy fixed cards individually through their editor, leaving other cards untouched. */
export async function followBoardLanguages(page: Page, labels: string[]) {
  for (const label of labels) {
    await page.getByRole('button', { name: `Edit tile ${label}`, exact: true }).click();
    await page.getByRole('button', { name: 'Follow board language', exact: true }).click();
    await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  }
}

/** Authenticate, seed stable boards, and wait for the dashboard creation action; settings overrides make assumptions such as speech source explicit. */
export async function openExistingLibrary(page: Page, settings: Partial<Library['settings']> = {}) {
  await openSignedInApp(page);
  await expect(page.getByRole('heading', { name: 'Choose your languages', exact: true })).toBeVisible();
  await page.evaluate(async library => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('little-say'); request.onsuccess = () => resolve(request.result); });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put(library, 'library');
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    }); db.close();
  }, { ...starterLibrary(), settings: { ...starterLibrary().settings, ...settings } });
  await page.reload();
  await expect(page.getByRole('button', { name: /^(New board|Resume draft)$/ })).toBeVisible();
}
