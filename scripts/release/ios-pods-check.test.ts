/** @file Exercises the macOS diagnostic's failure classification and command boundary with fake subprocess results. */
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';

const sha = 'a'.repeat(40);
const installed = 'Installing GoogleSignIn (10.0.0)\nInstalling AppCheckCore (11.3.2)\nInstalling GoogleUtilities (8.1.4)\nInstalling RecaptchaInterop (101.0.0)\n';
const failure = installed + 'The following Swift pods cannot yet be integrated as static libraries: AppCheckCore depends on GoogleUtilities and RecaptchaInterop';
const source = readFileSync(resolve('scripts/release/ios-pods-check.mjs'), 'utf8')
  .replace(/^import .*;\r?$/gm, '').replace('new URL(import.meta.url)', "'diagnostic-script'");

function diagnostic(outcome: string, podStatus: number, podLog: string, prebuildStatus = 0, podLock = '') {
  const files = new Map<string, string>(), descriptors = new Map<number, string>(), commands: string[][] = [];
  const process = { platform: 'darwin', argv: ['node', 'check', 'checkout', sha, outcome, 'evidence'], env: {}, exitCode: 0 };
  runInNewContext(source, {
    process, resolve, join, createHash, console: { log() {} },
    mkdirSync() {}, closeSync() {},
    existsSync: (path: string) => files.has(path),
    openSync(path: string) { const fd = descriptors.size + 1; descriptors.set(fd, path); files.set(path, ''); return fd; },
    readFileSync: (path: string) => files.get(path) ?? 'fixture-source',
    writeFileSync: (path: string, value: string) => files.set(path, value),
    copyFileSync: (from: string, to: string) => files.set(to, files.get(from)!),
    spawnSync(command: string, args: string[], options: { stdio: unknown[]; env: Record<string, string> }) {
      commands.push([command, ...args]);
      expect(options.env.LITTLE_SAY_GOOGLE_IOS_URL_SCHEME).toBe('');
      expect(options.env.EXPO_NO_DOTENV).toBe('1');
      let text = '', status = 0;
      if (command === 'git' && args[0] === 'rev-parse') text = sha;
      if (command === 'node' && args.includes('prebuild')) status = prebuildStatus;
      if (command === 'pod' && args.includes('install')) {
        status = podStatus; text = podLog;
        if (podLock) files.set(resolve('checkout/apps/mobile/ios/Podfile.lock'), podLock);
      }
      files.set(descriptors.get(options.stdio[1] as number)!, text);
      return { status };
    },
  });
  return { status: process.exitCode, result: JSON.parse(files.get(resolve('evidence/result.json'))!), commands };
}

it('accepts only the diagnosed baseline failure and still records exact pod versions', () => {
  const result = diagnostic('baseline', 1, failure);
  expect(result.status).toBe(0);
  expect(result.result.result).toBe('module-map-failure-reproduced');
  expect(result.result.podVersions.AppCheckCore.observed).toBe('11.3.2');
});

it.each([
  ['baseline', 0, installed], ['baseline', 1, installed + 'network failure'],
  ['baseline', 1, failure.replace('11.3.2', '11.4.0')], ['fix', 1, failure],
])('rejects unexpected %s pod status %s', (outcome, status, log) => {
  expect(diagnostic(String(outcome), Number(status), String(log)).status).toBe(1);
});

it('accepts a passing fix without invoking any build, signing or provider command', () => {
  const result = diagnostic('fix', 0, installed);
  expect(result.status).toBe(0);
  expect(result.commands.filter(([command]) => command === 'pod')).toEqual([
    ['pod', '_1.16.2_', '--version'], ['pod', '_1.16.2_', 'install'],
  ]);
  expect(result.commands.find(command => command.includes('prebuild'))?.slice(-4)).toEqual(['prebuild', '--platform', 'ios', '--no-install']);
  expect(result.commands.find(([command]) => command === 'xcodebuild')).toEqual(['xcodebuild', '-version']);
});

it('stops before CocoaPods when prebuild fails', () => {
  const result = diagnostic('fix', 0, installed, 1);
  expect(result.status).toBe(1);
  expect(result.commands.some(command => command.includes('install'))).toBe(false);
});

it('reads resolved lockfile versions rather than earlier nested dependency constraints', () => {
  const lock = `PODS:
  - AppCheckCore (11.3.2):
    - GoogleUtilities/Environment (~> 8.0)
    - RecaptchaInterop (~> 101.0)
  - GoogleSignIn (10.0.0):
    - AppCheckCore (~> 11.0)
  - GoogleUtilities (8.1.4):
    - GoogleUtilities/Environment (= 8.1.4)
  - GoogleUtilities/Environment (8.1.4)
  - RecaptchaInterop (101.0.0)
`;
  const result = diagnostic('fix', 0, 'Pod installation complete!', 0, lock);
  expect(result.status).toBe(0);
  expect(result.result.podVersions.GoogleUtilities.observed).toBe('8.1.4');
  expect(result.result.podVersions.RecaptchaInterop.observed).toBe('101.0.0');
});
