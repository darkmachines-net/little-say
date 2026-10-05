/** @file Configures the Node ESM server bundle and includes the shared core implementation. */

import { defineConfig } from 'tsup';
// SQLite requires its node: prefix; stripping it asks Node for an unrelated npm package.
export default defineConfig({ entry: ['src/index.ts'], format: ['esm'], target: 'node22', removeNodeProtocol: false, noExternal: ['@little-say/core'], clean: true });
