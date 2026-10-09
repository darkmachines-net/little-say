/** @file Pins capture imports to this checkout, including the core workspace. */
import { defineConfig } from 'vitest/config';
export default defineConfig({ resolve: { alias: { '@little-say/core': "C:\\Users\\MChar\\Documents\\Codex\\2026-10-08\\task-9\\little-say-pr35\\packages\\core\\src\\index.ts" } }, test: { include: ["apps/server/test/capture-payloads.test.ts","apps/server/test/capture-presets.test.ts"], testTimeout: 30000 } });
