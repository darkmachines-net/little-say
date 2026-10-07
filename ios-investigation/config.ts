/** @file Runs isolated, mocked iOS lifecycle investigations; not device evidence. */
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['artifacts/ios-investigation/investigation.test.ts'] } });
