/** @file Runs unsigned, credential-free iOS prebuild/pod diagnostics on an exact disposable macOS checkout. */
import { spawnSync } from 'node:child_process';
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const [checkout, expectedSha, outcome, output] = process.argv.slice(2);
if (process.platform !== 'darwin') throw new Error('This check requires macOS; it does not build or sign an app.');
if (!checkout || !output || !/^[a-f0-9]{40}$/.test(expectedSha ?? '') || !['baseline', 'fix'].includes(outcome)) {
  throw new Error('Usage: node ios-pods-check.mjs CHECKOUT FULL_SHA baseline|fix OUTPUT');
}
if (process.env.EXPO_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN) {
  throw new Error('Run this diagnostic without provider or repository tokens in the environment.');
}
const root = resolve(checkout), evidence = resolve(output), app = join(root, 'apps/mobile');
mkdirSync(evidence, { recursive: true });
const env = { ...process.env, LITTLE_SAY_GOOGLE_IOS_URL_SCHEME: '', EXPO_NO_DOTENV: '1', EXPO_NO_TELEMETRY: '1', CI: '1', COCOAPODS_DISABLE_STATS: 'true' };
const hashes = {};
const record = { source: expectedSha, outcome, checkedAt: new Date().toISOString(), tools: {}, commands: [], hashes, result: 'incomplete' };
const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex');
function run(name, command, args, cwd = root, allowFailure = false) {
  const file = join(evidence, `${name}.log`), fd = openSync(file, 'w');
  let result;
  try { result = spawnSync(command, args, { cwd, env, stdio: ['ignore', fd, fd], timeout: 20 * 60 * 1000 }); }
  finally { closeSync(fd); }
  record.commands.push({ command, args, status: result.status, error: result.error?.message ?? null });
  hashes[`${name}.log`] = digest(file);
  if (result.error || (result.status !== 0 && !allowFailure)) throw new Error(`${name} failed; see retained log`);
  return { status: result.status, text: readFileSync(file, 'utf8') };
}
function retain(relative, name) {
  const file = join(root, relative);
  if (existsSync(file)) { copyFileSync(file, join(evidence, name)); hashes[name] = digest(file); }
}
try {
  const actual = run('source', 'git', ['rev-parse', 'HEAD']).text.trim();
  if (actual !== expectedSha || run('status', 'git', ['status', '--porcelain']).text.trim()) throw new Error('Expected exact clean source checkout.');
  if (existsSync(join(app, 'ios'))) throw new Error('Use a fresh checkout without generated iOS files.');
  for (const [name, command, args] of [
    ['node', 'node', ['--version']], ['npm', 'npm', ['--version']], ['ruby', 'ruby', ['--version']],
    ['cocoapods', 'pod', ['_1.16.2_', '--version']], ['xcode', 'xcodebuild', ['-version']], ['os', 'sw_vers', []],
  ]) record.tools[name] = run(name, command, args).text.trim();
  record.runnerImage = { os: process.env.ImageOS, version: process.env.ImageVersion };
  retain('package-lock.json', 'package-lock.json');
  retain('apps/mobile/app.config.js', 'app.config.js');
  hashes['diagnostic-script'] = digest(new URL(import.meta.url));
  run('npm-ci', 'npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
  run('prebuild', 'node', [join(root, 'node_modules/expo/bin/cli'), 'prebuild', '--platform', 'ios', '--no-install'], app);
  retain('apps/mobile/ios/Podfile', 'Podfile');
  retain('apps/mobile/ios/Podfile.properties.json', 'Podfile.properties.json');
  const pods = run('pod-install', 'pod', ['_1.16.2_', 'install'], join(app, 'ios'), true);
  retain('apps/mobile/ios/Podfile.lock', 'Podfile.lock');
  const reproduced = pods.status !== 0 && /Swift pods cannot yet be integrated as static libraries/.test(pods.text)
    && ['AppCheckCore', 'GoogleUtilities', 'RecaptchaInterop'].every(name => pods.text.includes(name));
  record.result = pods.status === 0 ? 'pod-install-passed' : reproduced ? 'module-map-failure-reproduced' : 'other-pod-failure';
  // Do not mistake another failure, dependency drift, or an unexpectedly passing baseline for reproduction.
  const expectedPods = { GoogleSignIn: '10.0.0', AppCheckCore: '11.3.2', GoogleUtilities: '8.1.4', RecaptchaInterop: '101.0.0' };
  const lock = existsSync(join(evidence, 'Podfile.lock')) ? readFileSync(join(evidence, 'Podfile.lock'), 'utf8') : '';
  record.podVersions = Object.fromEntries(Object.entries(expectedPods).map(([name, version]) => [name, {
    expected: version, observed: (lock.match(new RegExp(`  - ${name}(?:/[^ ]+)? \\(([^)]+)\\)`))
      ?? pods.text.match(new RegExp(`Installing ${name} \\(([^)]+)\\)`)))?.[1] ?? null,
  }]));
  if (Object.values(record.podVersions).some(pod => pod.observed !== pod.expected)) throw new Error('Pod versions differ from the diagnosed failure; inspect evidence before interpreting the comparison.');
  if (outcome === 'baseline' ? !reproduced : pods.status !== 0) throw new Error(`Unexpected ${outcome} result: ${record.result}`);
} catch (error) {
  record.error = error.message;
  process.exitCode = 1;
} finally {
  writeFileSync(join(evidence, 'result.json'), JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify({ source: expectedSha, outcome, result: record.result, error: record.error }));
}
