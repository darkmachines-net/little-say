/** @file Runs issue32 browser validation on its own port with real provider access disabled. */
import { defineConfig } from './little-say-translations/node_modules/@playwright/test';
import path from 'node:path';
export default defineConfig({
  testDir: path.join(__dirname, 'little-say-translations/tests/web'), outputDir: path.join(__dirname, 'browser-results'),
  workers: 1, fullyParallel: false, timeout: 45000, expect: { timeout: 7000 },
  use: { baseURL: 'http://127.0.0.1:7520', channel: 'msedge', viewport: { width: 1180, height: 900 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node dist/index.js', cwd: path.join(__dirname, 'little-say-translations/apps/server'), url: 'http://127.0.0.1:7520/api/health', reuseExistingServer: false, env: { HOST: '127.0.0.1', PORT: '7520', WEB_ROOT: path.join(__dirname, 'little-say-translations/apps/mobile/dist'), ALLOWED_ORIGINS: 'http://127.0.0.1:7520', AAC_OPENAI_KEY: '', OPENAI_API_KEY: '', DATABASE_URL: '', PGHOST: '', PGDATABASE: '', AAC_IMAGE_GENERATION: 'false' } },
});
