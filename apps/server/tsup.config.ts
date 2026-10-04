/** @file Configures the Node ESM server bundle and includes the shared core implementation. */

import { defineConfig } from 'tsup';
export default defineConfig({ entry: ['src/index.ts'], format: ['esm'], target: 'node22', noExternal: ['@little-say/core'], clean: true });
