/**
 * @file Runs browser scenarios against an isolated local server with AI credentials disabled and
 * failure artifacts retained.
 */

import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/web', fullyParallel: false, workers: 1, timeout: 45000,
  expect: { timeout: 7000 },
  use: { baseURL: 'http://127.0.0.1:4175', viewport: { width: 1180, height: 900 }, screenshot: 'only-on-failure', trace: 'retain-on-failure', serviceWorkers: 'allow' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: { command: 'node --import tsx scripts/test-server.ts', url: 'http://127.0.0.1:4175/api/ready', timeout: 30000, reuseExistingServer: false },
});
