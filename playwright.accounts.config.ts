/** @file Runs account browser contracts against an owned disposable database and local Auth emulator. */
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testMatch: 'accounts.spec.ts',
  testIgnore: [],
});
