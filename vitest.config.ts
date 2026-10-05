/** @file Selects shared, server, mobile-service, and script unit tests with a common timeout. */

import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['packages/**/*.test.ts', 'apps/server/**/*.test.ts', 'apps/mobile/src/**/*.test.ts', 'scripts/**/*.test.ts'], exclude: ['apps/server/test/accounts.test.ts', 'apps/server/test/chatgpt.test.ts', '**/*.integration.test.ts'], testTimeout: 10000 } });
