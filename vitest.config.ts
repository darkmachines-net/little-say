import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['packages/**/*.test.ts', 'apps/server/**/*.test.ts', 'apps/mobile/src/**/*.test.ts', 'scripts/**/*.test.ts'], testTimeout: 10000 } });
