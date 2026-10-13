/**
 * @file Maintains mirrored server and native versions and validates version-only server release
 * commits.
 */

import { resolve } from 'node:path';
import { assert, cleanCommit, fail, git, isMain, parseArgs, readJson, root, writeJson } from './common';
import { bumpVersion } from '../../tools/release-engine/index.mjs';

export const serverFiles = ['release.json', 'package.json', 'apps/server/package.json', 'package-lock.json'];
/** Increment a stable semantic version by one major, minor, or patch step; reject unsupported input. */
export function bump(version: string, part: string) {
  assert(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version), 'Expected a stable semantic version.');
  assert(['patch', 'minor', 'major'].includes(part), 'Choose patch, minor, or major.');
  return bumpVersion(version, part as 'patch' | 'minor' | 'major');
}
/** Clone version documents and update all server version mirrors without mutating the inputs. */
export function serverDocuments(documents: Record<string, any>, version: string) {
  const next = structuredClone(documents);
  next['release.json'].version = version;
  next['package.json'].version = version;
  next['apps/server/package.json'].version = version;
  next['package-lock.json'].version = version;
  next['package-lock.json'].packages[''].version = version;
  next['package-lock.json'].packages['apps/server'].version = version;
  return next;
}
/** Verify server and native version mirrors and native build numbers agree with their release contracts. */
export function checkVersions(cwd = root) {
  const docs = Object.fromEntries(serverFiles.map(file => [file, readJson(resolve(cwd, file))]));
  const expected = serverDocuments(docs, docs['release.json'].version);
  bump(docs['release.json'].version, 'patch');
  assert(JSON.stringify(docs) === JSON.stringify(expected), 'Server version mirrors differ. Use release:prepare server.');
  const native = readJson(resolve(cwd, 'native-release.json'));
  bump(native.version, 'patch');
  assert(Number.isSafeInteger(native.androidVersionCode) && native.androidVersionCode > 0 && /^[1-9]\d*$/.test(native.iosBuildNumber), 'Invalid native build numbers.');
  for (const file of ['apps/mobile/app.json', 'apps/mobile/package.json']) {
    const doc = readJson(resolve(cwd, file));
    assert((doc.expo || doc).version === native.version, `${file} differs from native-release.json.`);
  }
  assert(docs['package-lock.json'].packages['apps/mobile'].version === native.version, 'Native lockfile version differs.');
}
/**
 * Require exactly one semantic increment affecting only server version fields in the four release
 * documents; return the new version.
 */
export function validateServerChange(before: Record<string, any>, after: Record<string, any>, changed: string[]) {
  assert(changed.length === serverFiles.length && changed.every(file => serverFiles.includes(file)), 'A server release commit must change only the four server version files.');
  const version = after['release.json'].version;
  assert(['patch', 'minor', 'major'].some(part => bump(before['release.json'].version, part) === version), 'Release must be one patch, minor, or major increment.');
  assert(JSON.stringify(serverDocuments(before, version)) === JSON.stringify(after), 'Release includes changes other than server version fields.');
  return version;
}
/**
 * Inspect a full Git commit and its parent, validating that the diff is a permitted server release
 * change.
 */
export function validateCommit(commit: string, cwd = root) {
  assert(/^[0-9a-f]{40}$/.test(commit), 'Provide the full 40-character release commit SHA.');
  const before = Object.fromEntries(serverFiles.map(file => [file, JSON.parse(git(['show', `${commit}^:${file}`], cwd))]));
  const after = Object.fromEntries(serverFiles.map(file => [file, JSON.parse(git(['show', `${commit}:${file}`], cwd))]));
  return validateServerChange(before, after, git(['diff', '--name-only', `${commit}^`, commit], cwd).split(/\r?\n/));
}
/**
 * Require a clean checkout, bump the selected release contract and mirrors, and revalidate them,
 * leaving changes uncommitted for review.
 */
export function prepare(target: string, part: string, cwd = root) {
  cleanCommit(cwd);
  checkVersions(cwd);
  if (target === 'server') {
    const docs = Object.fromEntries(serverFiles.map(file => [file, readJson(resolve(cwd, file))]));
    for (const [file, doc] of Object.entries(serverDocuments(docs, bump(docs['release.json'].version, part)))) writeJson(resolve(cwd, file), doc);
  } else {
    assert(target === 'native', 'Choose server or native.');
    const native = readJson(resolve(cwd, 'native-release.json'));
    native.version = bump(native.version, part); native.androidVersionCode++; native.iosBuildNumber = String(Number(native.iosBuildNumber) + 1);
    writeJson(resolve(cwd, 'native-release.json'), native);
    for (const file of ['apps/mobile/package.json', 'apps/mobile/app.json']) {
      const doc = readJson(resolve(cwd, file)); (doc.expo || doc).version = native.version; writeJson(resolve(cwd, file), doc);
    }
    const lock = readJson(resolve(cwd, 'package-lock.json')); lock.packages['apps/mobile'].version = native.version; writeJson(resolve(cwd, 'package-lock.json'), lock);
  }
  checkVersions(cwd);
}
if (isMain(import.meta.url)) {
  try {
    const [command, target, ...rest] = process.argv.slice(2);
    if (command === 'check') checkVersions();
    else if (command === 'validate') console.log(validateCommit(target));
    else if (command === 'prepare') { const args = parseArgs(rest, ['bump']); prepare(target, args.bump || 'patch'); console.log('Version prepared. Review and commit these changes before building.'); }
    else throw new Error('Usage: release:check | release:prepare -- server|native --bump patch|minor|major');
  } catch (error) { fail(error); }
}
