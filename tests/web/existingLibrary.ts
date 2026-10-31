/** @file Seeds isolated browser libraries and adds/removes shared languages through their visible controls. */

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

/** Bypass first-use setup with stable boards; overrides make feature assumptions such as speech source explicit. */
export async function openExistingLibrary(page: Page, settings: Partial<Library['settings']> = {}) {
  await page.goto('/app');
  await page.getByRole('button', { name: 'Continue without an account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose your languages', exact: true })).toBeVisible();
  await page.evaluate(async library => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('little-say'); request.onsuccess = () => resolve(request.result); });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put(library, 'library');
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    }); db.close();
  }, { ...starterLibrary(), settings: { ...starterLibrary().settings, accountChoiceMade: true, ...settings } });
  await page.reload();
  await expect(page.getByText('Your soundboards', { exact: true })).toBeVisible();
}
