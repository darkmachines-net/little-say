/** @file Retains one-off full payload evidence while leaving maintained tests free of capture machinery. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = path.resolve('little-say-prompts');
const phase = process.argv[2];
if (!['before', 'after'].includes(phase)) throw new Error('Expected before or after');
const out = path.resolve('evidence', phase);
fs.mkdirSync(out, { recursive: true });
const tests = ['apps/server/test/prompt-payloads.test.ts', 'packages/core/src/prompt-presets.test.ts'];
const originals = tests.map(file => fs.readFileSync(path.join(root, file), 'utf8'));
try {
  tests.forEach((file, index) => {
    let text = originals[index];
    text = "import { writeFileSync as saveCapture } from 'node:fs';\n" + text;
    if (index === 0) {
      text = text.replace('const observed: Record<string, string> = {};', 'const observed: Record<string, string> = {}; const payloads: Record<string, unknown> = {};');
      text = text.replace('observed[name] = digest(value);', 'observed[name] = digest(value); payloads[name] = value;');
      text = text.replace('expect(observed).toMatchSnapshot();', `saveCapture(${JSON.stringify(path.join(out, 'payloads.json'))}, JSON.stringify(payloads, null, 2) + '\\n'); expect(observed).toMatchSnapshot();`);
    } else text = text.replace('expect(Object.fromEntries', `saveCapture(${JSON.stringify(path.join(out, 'presets.json'))}, JSON.stringify(values, null, 2) + '\\n'); expect(Object.fromEntries`);
    fs.writeFileSync(path.join(out, path.basename(file)), text);
    fs.writeFileSync(path.join(root, file), text);
  });
  const args = ['node_modules/vitest/vitest.mjs', 'run', ...tests, ...(phase === 'before' ? ['--update'] : [])];
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  fs.writeFileSync(path.join(out, 'test.log'), result.stdout + result.stderr);
  console.log(result.stdout, result.stderr);
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  tests.forEach((file, index) => fs.writeFileSync(path.join(root, file), originals[index]));
}
