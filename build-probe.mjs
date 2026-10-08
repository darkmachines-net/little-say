/** @file Bundles the isolated QA source experiment using the retained existing build tool, without modifying product files. */
import { createRequire } from 'node:module';
const require=createRequire('C:/Users/MChar/Documents/Codex/2026-10-08/task-10/little-say-translations/package.json');
const {build}=require('esbuild');
await build({entryPoints:['reassess38/probe-entry.ts'],outfile:'reassess38/probe.mjs',bundle:true,platform:'node',format:'esm',nodePaths:['C:/Users/MChar/Documents/Codex/2026-10-08/task-10/little-say-translations/node_modules']});
