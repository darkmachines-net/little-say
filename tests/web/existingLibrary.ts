/** @file Seeds an existing browser library with explicit optional settings for isolated feature scenarios. */

import { starterLibrary } from '../fixtures/library';
import { expect, type Page } from '@playwright/test';
import { type Library } from '@little-say/core';

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
