/** @file Runs existing mocked setup/conversation checks on a dedicated local port. */
import { defineConfig } from '@playwright/test';
import original from '../playwright.config';
export default defineConfig({ ...original, testDir: '../tests/web', outputDir: '../../evidence-oct09/browser-results', use: { ...original.use, baseURL: 'http://127.0.0.1:4598' }, webServer: { command: 'npm run start', cwd: '..', url: 'http://127.0.0.1:4598/api/health', timeout: 30000, reuseExistingServer: false, env: { PORT: '4598', HOST: '127.0.0.1', ALLOWED_ORIGINS: 'http://127.0.0.1:4598', AAC_OPENAI_KEY: '', OPENAI_API_KEY: '', FIREBASE_PROJECT_ID: '', FIREBASE_AUTH_EMULATOR_HOST: '' } } });

