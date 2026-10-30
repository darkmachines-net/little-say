/**
 * @file Runs browser scenarios against an isolated local server with AI credentials disabled and
 * failure artifacts retained.
 */

import { defineConfig } from '@playwright/test';
const origin = `http://127.0.0.1:${process.env.TEST_API_PORT || '4175'}`;
export default defineConfig({
  outputDir: process.env.TEST_RESULTS_DIR || 'test-results',
  testDir: './tests/web', fullyParallel: false, workers: 1, timeout: 45000,
  testIgnore: 'accounts.spec.ts',
  expect: { timeout: 7000 },
  use: { baseURL: origin, viewport: { width: 1180, height: 900 }, screenshot: 'only-on-failure', trace: 'retain-on-failure', serviceWorkers: 'allow' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: { command: 'node --import tsx scripts/test-server.ts', url: origin + '/api/ready', timeout: 30000, reuseExistingServer: false },
});
