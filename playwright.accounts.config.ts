/** @file Runs account browser contracts against an owned disposable database and local Auth emulator. */
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testMatch: 'accounts.spec.ts',
  testIgnore: [],
  webServer: {
    command: 'node --import tsx scripts/test-server.ts',
    url: 'http://127.0.0.1:4175/api/ready',
    timeout: 30000,
    reuseExistingServer: false,
  },
});
