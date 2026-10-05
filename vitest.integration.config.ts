/** @file Requires real Postgres for storage suites and the Firebase Auth emulator for identity integration suites. */
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['apps/server/test/accounts.test.ts', 'apps/server/test/chatgpt.test.ts', 'apps/server/test/firebase.integration.test.ts'], testTimeout: 20000, hookTimeout: 20000, fileParallelism: false } });
