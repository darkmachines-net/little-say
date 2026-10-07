/** @file Demonstrates that the unchanged payload baseline rejects lost addendum whitespace. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = path.resolve('little-say-prompts');
const file = path.join(root, 'prompts/server/board.json');
const original = fs.readFileSync(file);
try {
  const resource = JSON.parse(original);
  resource.pictures = resource.pictures.trimStart();
  fs.writeFileSync(file, JSON.stringify(resource, null, 2) + '\n');
  const broken = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'apps/server/test/prompt-payloads.test.ts'], { cwd: root, encoding: 'utf8' });
  fs.writeFileSync('evidence/negative-control.log', broken.stdout + broken.stderr);
  if (broken.status === 0) throw new Error('Negative control was not detected');
  console.log('Lost leading addendum newline was rejected by the baseline snapshot.');
} finally { fs.writeFileSync(file, original); }
const restored = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'apps/server/test/prompt-payloads.test.ts'], { cwd: root, encoding: 'utf8' });
fs.writeFileSync('evidence/restored-control.log', restored.stdout + restored.stderr);
console.log(restored.stdout, restored.stderr);
process.exitCode = restored.status ?? 1;
