/** @file Runs the maintained browser suite on a task-owned port with installed Edge. */
import { defineConfig } from './little-say-translations/node_modules/@playwright/test/index.mjs';
export default defineConfig({
  testDir: './little-say-translations/tests/web', testIgnore: 'accounts.spec.ts',
  fullyParallel: false, workers: 1, timeout: 45000, expect: { timeout: 7000 },
  outputDir: './records/browser-results', reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:7635', viewport: { width: 1180, height: 900 }, screenshot: 'only-on-failure', trace: 'retain-on-failure', serviceWorkers: 'allow' },
  projects: [{ name: 'edge', use: { browserName: 'chromium', channel: 'msedge' } }],
  webServer: { command: 'npm.cmd run start', cwd: './little-say-translations', url: 'http://127.0.0.1:7635/api/health', timeout: 30000, reuseExistingServer: false, env: { PORT: '7635', HOST: '127.0.0.1', ALLOWED_ORIGINS: 'http://127.0.0.1:7635', AAC_OPENAI_KEY: '', OPENAI_API_KEY: '', DATABASE_URL: '' } },
});
