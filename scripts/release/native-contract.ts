/**
 * @file Validates native release identity, retained build artifacts, EAS profiles, and OTA
 * compatibility.
 */

import { existsSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { assert, git, mobile, readJson, root, sha256 } from './common';

export type Platform = 'android' | 'ios';
export type Profile = 'internal' | 'production';
export interface NativeRelease { version: string; androidVersionCode: number; iosBuildNumber: string; expoOwner: string; expoProjectId: string; serverUrl: string; }
export interface Baseline {
  schema: 1; commit: string; platform: Platform; profile: Profile; channel: Profile; environment: string;
  release: NativeRelease; fingerprint: string; environmentHash: string;
  artifacts: { file: string; sha256: string }[];
  createdAt: string;
}
/** Read the native release contract and validate its Expo project identity and HTTPS server origin. */
export function releaseConfig(cwd = root): NativeRelease {
  const config = readJson<NativeRelease>(resolve(cwd, 'native-release.json'));
  assert(/^[a-z\d][a-z\d_-]*$/i.test(config.expoOwner || ''), 'Set expoOwner with native:configure.');
  assert(/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(config.expoProjectId || ''), 'Set expoProjectId with native:configure.');
  const url = new URL(config.serverUrl || 'about:blank');
  assert(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'Native releases require an HTTPS server origin without credentials or paths.');
  return { ...config, serverUrl: url.origin };
}
/**
 * Assert the retained build record has supported schema, identity, channel, environment, and
 * compatibility fields.
 */
export function validateBaseline(value: unknown): asserts value is Baseline {
  const b = value as Baseline;
  assert(b?.schema === 1 && /^[a-f0-9]{40}$/.test(b.commit) && ['android', 'ios'].includes(b.platform) && ['internal', 'production'].includes(b.profile), 'Invalid retained native baseline.');
  assert(b.channel === b.profile && b.environment === (b.profile === 'internal' ? 'preview' : 'production'), 'Invalid baseline channel/environment.');
  assert(typeof b.fingerprint === 'string' && b.fingerprint.length > 20 && /^[a-f0-9]{64}$/.test(b.environmentHash), 'Missing native compatibility proof.');
  assert(Array.isArray(b.artifacts) && b.artifacts.length > 0, 'Missing retained artifacts.');
}
/** Verify every retained build file remains inside its build directory and matches its recorded digest. */
export function verifyArtifacts(baseline: Baseline, directory: string) {
  validateBaseline(baseline);
  for (const artifact of baseline.artifacts) {
    const file = resolve(directory, artifact.file);
    const rel = relative(directory, file);
    assert(rel && !rel.startsWith('..') && !isAbsolute(rel), 'Artifact must be inside its retained build directory.');
    assert(existsSync(file) && sha256(file) === artifact.sha256, `Retained artifact missing or changed: ${artifact.file}`);
  }
}
/**
 * Require matching release, platform, profile, native fingerprint, and environment hash, plus baseline
 * commit ancestry, before allowing OTA publication.
 */
export function verifyOta(baseline: Baseline, current: { release: NativeRelease; fingerprint: string; environmentHash: string; platform: Platform; profile: Profile }, cwd = root) {
  validateBaseline(baseline);
  assert(baseline.platform === current.platform && baseline.profile === current.profile, 'Baseline platform/profile differs.');
  assert(JSON.stringify(baseline.release) === JSON.stringify(current.release), 'Native version, build number, project, or server changed. Build and install/submit a new native release first.');
  assert(baseline.fingerprint === current.fingerprint, 'Native dependencies/configuration changed. Build a new native release first.');
  assert(baseline.environmentHash === current.environmentHash, 'EAS environment changed since the native build. Rebuild with the intended environment.');
  git(['merge-base', '--is-ancestor', baseline.commit, 'HEAD'], cwd);
}
/**
 * Read the selected EAS build profile and require the expected channel, environment, and manual
 * versioning policy.
 */
export function profileConfig(profile: Profile) {
  const config = readJson(resolve(mobile, 'eas.json')).build[profile];
  assert(config && config.channel === profile && config.environment === (profile === 'internal' ? 'preview' : 'production') && config.autoIncrement === false, 'EAS profile differs from the release contract.');
  return config;
}
