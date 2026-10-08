/** @file Captures exact request and preset bytes from isolated actual-master and integrated PR sources. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const final = path.resolve('little-say-pr35');
const evidence = path.resolve('evidence-integration');
fs.mkdirSync(evidence, { recursive: true });
const sha = x => createHash('sha256').update(x).digest('hex');
const records = [];
for (const [phase, folder] of [['before', 'baseline-master'], ['after', 'little-say-pr35']]) {
  const root = path.resolve(folder), out = path.join(evidence, phase);
  fs.mkdirSync(out, { recursive: true });
  if (!fs.existsSync(path.join(root, 'node_modules'))) fs.symlinkSync(path.join(final, 'node_modules'), path.join(root, 'node_modules'), 'junction');
  const config = path.join(root, 'capture-current.config.ts');
  const files = ['apps/server/test/capture-payloads.test.ts', 'apps/server/test/capture-presets.test.ts'];
  const configText = `/** @file Pins capture imports to this checkout, including the core workspace. */\nimport { defineConfig } from 'vitest/config';\nexport default defineConfig({ resolve: { alias: { '@little-say/core': ${JSON.stringify(path.join(root, 'packages/core/src/index.ts'))} } }, test: { include: ${JSON.stringify(files)}, testTimeout: 30000 } });\n`;
  fs.writeFileSync(config, configText); fs.writeFileSync(path.join(out, 'capture-current.config.ts'), configText);
  let payload = fs.readFileSync(path.join(final, 'apps/server/test/prompt-payloads.test.ts'), 'utf8');
  payload = "import { writeFileSync as saveCapture } from 'node:fs';\n" + payload;
  payload = payload.replace('const observed: Record<string, string> = {};', 'const observed: Record<string, string> = {}; const payloads: Record<string, unknown> = {};');
  payload = payload.replace('observed[name] = digest(value);', 'observed[name] = digest(value); payloads[name] = value;');
  payload = payload.replace('expect(observed).toMatchSnapshot();', `saveCapture(${JSON.stringify(path.join(out, 'payloads.json'))}, JSON.stringify(payloads, null, 2) + '\\n');`);
  let presets = fs.readFileSync(path.join(final, 'apps/server/test/prompt-presets.test.ts'), 'utf8');
  presets = "import { writeFileSync as saveCapture, readFileSync } from 'node:fs';\n" + presets;
  if (phase === 'before') {
    presets = presets.replace("import { conversationPrompts } from '../../../packages/core/src/promptPresets';", '');
    presets = presets.replace('const conversation = [conversationPrompts.farm, conversationPrompts.snack, conversationPrompts.family];', `const mobile = readFileSync(${JSON.stringify(path.join(root, 'apps/mobile/src/ui/AiConversation.tsx'))}, 'utf8'); const conversation = Array.from(mobile.matchAll(/'(Create six [^']+)'/g), match => match[1]); expect(conversation).toHaveLength(3);`);
  }
  presets = presets.replace(/  expect\(Object\.fromEntries[^\n]+/, `  saveCapture(${JSON.stringify(path.join(out, 'presets.json'))}, JSON.stringify(values, null, 2) + '\\n');`);
  try {
    for (const [i, source] of [payload, presets].entries()) { fs.writeFileSync(path.join(root, files[i]), source); fs.writeFileSync(path.join(out, path.basename(files[i])), source); }
    const result = spawnSync(process.execPath, [path.join(final, 'node_modules/vitest/vitest.mjs'), 'run', '--config', config], { cwd: root, encoding: 'utf8', windowsHide: true });
    fs.writeFileSync(path.join(out, 'test.log'), result.stdout + result.stderr);
    if (result.status !== 0) throw new Error(`${phase} capture failed: ${result.stdout} ${result.stderr}`);
    records.push({ phase, source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), payloadSha256: sha(fs.readFileSync(path.join(out, 'payloads.json'))), presetsSha256: sha(fs.readFileSync(path.join(out, 'presets.json'))), coreResolution: path.join(root, 'packages/core/src/index.ts') });
  } finally { for (const file of [...files, 'capture-current.config.ts']) fs.unlinkSync(path.join(root, file)); }
}
for (const file of ['payloads.json', 'presets.json']) if (!fs.readFileSync(path.join(evidence, 'before', file)).equals(fs.readFileSync(path.join(evidence, 'after', file)))) throw new Error(`${file} differs`);
fs.writeFileSync(path.join(evidence, 'comparison.json'), JSON.stringify({ byteIdentical: true, records }, null, 2) + '\n');
console.log(JSON.stringify({ byteIdentical: true, records }, null, 2));
