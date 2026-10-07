/** @file Runs the existing playback tests against QA source with caches outside product history. */
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../qa-source/', import.meta.url));
export default {
  root,
  cacheDir: fileURLToPath(new URL('./cache/', import.meta.url)),
  resolve: { alias: { '@little-say/core': fileURLToPath(new URL('../qa-source/packages/core/src/index.ts', import.meta.url)) } },
  test: { include: ['apps/mobile/src/services/audioPlayback.test.ts','apps/mobile/src/services/hybridSpeech.test.ts','packages/core/src/interaction.test.ts'], testTimeout: 10000, maxWorkers: 1, fileParallelism: false },
};
