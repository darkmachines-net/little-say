/** @file Configures the Node ESM server bundle and includes the shared core implementation. */

import { defineConfig } from 'tsup';
export default defineConfig({ entry: ['src/index.ts', 'src/database-cli.ts'], format: ['esm'], target: 'node22', removeNodeProtocol: false, noExternal: ['@little-say/core'], clean: true });
