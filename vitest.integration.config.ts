/** @file Requires a real disposable PostgreSQL database for migration and transaction contract tests. */
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['apps/server/test/**/*.integration.test.ts'], testTimeout: 20000, hookTimeout: 20000, fileParallelism: false } });
