/** @file Allocates combined server/native version-only candidates and verifies their exact merged tree. */

import { resolve } from 'node:path';
import { assert, git, readJson, root, writeJson } from './common';
import type { ReleasePlan } from './contract';
import { serverDocuments, serverFiles } from './version';

export const releaseFiles = [...serverFiles, 'native-release.json', 'apps/mobile/package.json', 'apps/mobile/app.json'];

/** Apply the plan's allocated versions to cloned documents, never changing dependencies or product configuration. */
export function releaseDocuments(before: Record<string, any>, plan: ReleasePlan): Record<string, any> {
  const docs = plan.server ? serverDocuments(before, plan.serverVersion) : structuredClone(before);
  if (plan.native.length) {
    docs['native-release.json'] = { ...docs['native-release.json'], version: plan.nativeRelease.version, androidVersionCode: plan.nativeRelease.androidVersionCode, iosBuildNumber: plan.nativeRelease.iosBuildNumber };
    docs['apps/mobile/package.json'].version = plan.nativeRelease.version;
    docs['apps/mobile/app.json'].expo.version = plan.nativeRelease.version;
    docs['package-lock.json'].packages['apps/mobile'].version = plan.nativeRelease.version;
  }
  return docs;
}

/** Write only changed version documents to the clean candidate checkout. */
export function writeReleaseDocuments(plan: ReleasePlan): void {
  const before = Object.fromEntries(releaseFiles.map(path => [path, readJson(resolve(root, path))]));
  const after = releaseDocuments(before, plan);
  for (const path of releaseFiles) if (JSON.stringify(before[path]) !== JSON.stringify(after[path])) writeJson(resolve(root, path), after[path]);
}

/** Require the exact planned metadata diff from pinned source; reject extra files and edited dependency/configuration fields. */
export function validateCandidate(plan: ReleasePlan, commit: string, cwd = root): void {
  const read = (ref: string) => Object.fromEntries(releaseFiles.map(path => [path, JSON.parse(git(['show', `${ref}:${path}`], cwd))]));
  const expected = releaseDocuments(read(plan.source), plan);
  assert(JSON.stringify(expected) === JSON.stringify(read(commit)), 'Candidate contains unexpected metadata changes.');
  const changed = git(['diff', '--name-only', plan.source, commit], cwd).split(/\r?\n/).filter(Boolean);
  assert(changed.every(path => releaseFiles.includes(path)), 'Candidate contains non-version source changes.');
}
