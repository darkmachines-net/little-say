/** @file Verifies automatic release plans and semantic increments, profile isolation, dependency inputs, and strict version-only candidate metadata. */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { git, writeJson } from './common';
import { platforms, plannedRuntime, requiresDeployment, validateCloudBaseline, validatePlanPolicy, type Inputs, type NativeBuildBaseline, type ReleaseReceipt, type ServerReceipt } from './contract';
import { type Platform, type Profile } from './native-contract';
import { dependencyClosure, hash, relevantFile, sourceInputs } from './inputs';
import { hasWork, planRelease } from './planner';
import { releaseDocuments, releaseFiles, validateCandidate } from './metadata';

const commit = 'a'.repeat(40);
const release = { version: '0.1.0', androidVersionCode: 1, iosBuildNumber: '1', expoOwner: 'test', expoProjectId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', serverUrl: 'https://test.invalid' };
const inputs: Inputs = { server: 's', native: { android: 'a', ios: 'i' }, bundle: { android: 'ab', ios: 'ib' }, environmentHash: 'env' };
const server: ServerReceipt = { commit, version: '0.2.0', image: 'ghcr.io/test/app', digest: `sha256:${'a'.repeat(64)}`, input: inputs.server };
function baseline(platform: Platform, profile: Profile = 'internal'): NativeBuildBaseline {
  return { schema: 2, platform, profile, channel: profile, environment: profile === 'internal' ? 'preview' : 'production', commit, release, fingerprint: 'a'.repeat(40), compatibility: inputs.native[platform], environmentHash: inputs.environmentHash,
    runtimeVersion: release.version, buildId: platform, artifactUrl: 'https://example.invalid/app', artifactSha256: 'b'.repeat(64) };
}
function args() {
  const initial = { runId: '123', source: commit, profile: 'internal' as const, bump: 'patch', inputs: structuredClone(inputs), serverVersion: '0.2.0', nativeRelease: release, server };
  const previous: ReleaseReceipt = { schema: 1, runId: '122', profile: 'internal', commit, completedAt: new Date(0).toISOString(), server, baselines: platforms.map(p => baseline(p)), ota: [], plan: planRelease(initial), prepared: { commit, candidate: commit, tree: commit } };
  return { ...initial, previous };
}

describe('artifact selection and version allocation', () => {
  it('records a fingerprint-policy transition without relabeling historical native baselines', () => {
    const a = args(); a.inputs.bundle.android = 'updated JS';
    const plan = planRelease({ ...a, resolveRuntime: platform => (platform === 'android' ? 'a' : 'b').repeat(40) });
    expect(plan.schema).toBe(2); expect(plan.native).toEqual(platforms); expect(plan.baselines.every(b => b.schema === 2)).toBe(true);
    expect(plan.otaTargets.filter(t => t.eligible).map(t => t.runtimeVersion)).toEqual(['a'.repeat(40), 'b'.repeat(40)]);
    expect(plan.otaTargets.some(t => t.buildId && t.eligible)).toBe(false); expect(requiresDeployment(plan)).toBe(false);
    validatePlanPolicy(plan); expect(plannedRuntime(plan, 'ios')).toBe('b'.repeat(40));
    expect(requiresDeployment({ ...plan, schema: 1 })).toBe(true);
  });
  it('accepts verified fingerprint baseline identity while retaining strict legacy runtime validation', () => {
    const old = { ...baseline('android'), buildId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', environmentHash: 'e'.repeat(64), compatibility: 'c'.repeat(64) };
    validateCloudBaseline(old);
    expect(() => validateCloudBaseline({ ...old, runtimeVersion: 'a'.repeat(40) })).toThrow('compatibility');
    validateCloudBaseline({ ...old, schema: 3, runtimePolicy: 'fingerprint', runtimeVersion: 'a'.repeat(40) });
  });
  it('publishes a newly built fingerprint runtime even when native-only changes leave the bundle identity unchanged', () => {
    const a = args(); a.previous.baselines = a.previous.baselines.map(b => ({ ...b, schema: 3, runtimePolicy: 'fingerprint', runtimeVersion: 'c'.repeat(40) }));
    a.inputs.native.android = 'changed native configuration';
    const plan = planRelease({ ...a, resolveRuntime: platform => (platform === 'android' ? 'a' : 'b').repeat(40) });
    expect(plan.native).toEqual(['android']); expect(plan.ota).toEqual(['android']); expect(plan.changes.bundle).toEqual([]);
    expect(plan.otaTargets.filter(t => t.eligible)).toEqual([{ platform: 'android', runtimeVersion: 'a'.repeat(40), eligible: true, reason: 'new build in this run' }]);
    expect(requiresDeployment(plan)).toBe(false);
  });
  it.each(['patch', 'minor', 'major'])('does nothing for %s when verified inputs are unchanged', bump => {
    const plan = planRelease({ ...args(), bump }); expect(hasWork(plan)).toBe(false);
    expect(plan.mode).toBe('auto');
    expect(plan.serverVersion).toBe('0.2.0'); expect(plan.nativeRelease).toEqual(release);
  });
  it('builds only the image for server/web changes', () => {
    const a = args(); a.inputs.server = 'changed'; const plan = planRelease(a);
    expect(plan.server).toBe(true); expect(plan.native).toEqual([]); expect(plan.ota).toEqual([]); expect(plan.serverVersion).toBe('0.2.1');
  });
  it.each(['patch', 'minor', 'major'])('publishes JS changes without allocating versions for %s', bump => {
    const a = args(); a.inputs.bundle.android = 'new UI'; const plan = planRelease({ ...a, bump });
    expect(plan.ota).toEqual(['android']); expect(plan.native).toEqual([]); expect(plan.nativeRelease).toEqual(release);
    expect(plan.serverVersion).toBe('0.2.0'); expect(plan.server).toBe(false);
    expect(plan.otaTargets).toEqual([expect.objectContaining({ runtimeVersion: '0.1.0', eligible: true })]);
  });
  it('allocates only the affected platform build number', () => {
    const a = args(); a.inputs.native.android = 'new native'; const plan = planRelease(a);
    expect(plan.native).toEqual(['android']); expect(plan.nativeRelease).toMatchObject({ version: '0.1.1', androidVersionCode: 2, iosBuildNumber: '1' }); expect(plan.server).toBe(false);
  });
  it('selects every required artifact when server, native and bundle inputs change together', () => {
    const a = args(); a.inputs.server = 'new server'; a.inputs.native = { android: 'new android', ios: 'new ios' }; a.inputs.bundle = { android: 'new JS', ios: 'new JS' };
    const plan = planRelease({ ...a, bump: 'major' });
    expect(plan.server).toBe(true); expect(plan.native).toEqual(platforms); expect(plan.ota).toEqual(platforms);
    expect(plan.serverVersion).toBe('1.0.0'); expect(plan.nativeRelease).toMatchObject({ version: '1.0.0', androidVersionCode: 2, iosBuildNumber: '2' });
    expect(plan.otaTargets.filter(t => t.eligible)).toEqual(platforms.map(platform => ({ platform, runtimeVersion: '1.0.0', eligible: true, reason: 'new build in this run' })));
  });
  it.each(['server', 'android', 'ios', 'combined'] as const)('applies each requested increment only to selected %s components', target => {
    for (const [bump, serverVersion, nativeVersion] of [['patch', '0.2.1', '0.1.1'], ['minor', '0.3.0', '0.2.0'], ['major', '1.0.0', '1.0.0']]) {
      const a = args();
      const image = target === 'server' || target === 'combined';
      const android = target === 'android' || target === 'combined', ios = target === 'ios' || target === 'combined';
      if (image) a.inputs.server = 'changed';
      if (android) a.inputs.native.android = 'changed';
      if (ios) a.inputs.native.ios = 'changed';
      const plan = planRelease({ ...a, bump });
      expect(plan.serverVersion).toBe(image ? serverVersion : '0.2.0');
      expect(plan.nativeRelease).toEqual({ ...release, version: android || ios ? nativeVersion : release.version, androidVersionCode: android ? 2 : 1, iosBuildNumber: ios ? '2' : '1' });
      expect(plan.ota).toEqual([]);
    }
  });
  it('keeps client profiles independent while reusing the global image', () => {
    const plan = planRelease({ ...args(), profile: 'production', previous: undefined });
    expect(plan.server).toBe(false); expect(plan.native).toEqual(platforms); expect(plan.ota).toEqual(platforms); expect(plan.baselines).toEqual([]);
    expect(plan.submissions).toEqual(platforms); expect(planRelease(args()).submissions).toEqual([]);
  });
  it('requires native builds after environment drift and bootstraps missing evidence', () => {
    const a = args(); a.inputs.environmentHash = 'changed'; expect(planRelease(a).native).toEqual(platforms);
    const first = planRelease({ ...args(), previous: undefined, server: undefined }); expect(first.server).toBe(true); expect(first.native).toEqual(platforms);
  });
  it('does not duplicate imported evidence or let old imports replace newer builds', () => {
    const a = args(); a.previous.baselines.push({ ...baseline('android'), buildId: 'new', compatibility: 'newer' }); a.inputs.native.android = 'newer';
    const plan = planRelease({ ...a, imported: [baseline('android')] }); expect(plan.native).toEqual([]); expect(plan.baselines).toHaveLength(3);
  });
});

describe('platform-resolved source and dependency inputs', () => {
  it('includes web in images and excludes it from native bundles', () => {
    const files = new Set(['apps/mobile/src/Entry.tsx', 'apps/mobile/src/Entry.web.tsx']);
    expect(relevantFile('apps/mobile/src/Entry.web.tsx', 'server', files)).toBe(true);
    expect(relevantFile('apps/mobile/src/Entry.tsx', 'server', files)).toBe(false);
    expect(relevantFile('apps/mobile/src/Entry.web.tsx', 'ios', files)).toBe(false);
    expect(relevantFile('apps/mobile/src/Entry.tsx', 'ios', files)).toBe(true);
    expect(relevantFile('apps/mobile/src/website/styles.css', 'ios', files)).toBe(false);
    expect(relevantFile('apps/mobile/assets/brand/favicon.png', 'android', files)).toBe(false);
    expect(relevantFile('apps/mobile/assets/brand/favicon.png', 'server', files)).toBe(true);
    expect(relevantFile('apps/mobile/assets/brand/mountain@2x.png', 'android', files)).toBe(true);
    expect(relevantFile('packages/core/src/Storage.web.ts', 'android', files)).toBe(false);
    expect(relevantFile('packages/core/src/Storage.native.ts', 'android', new Set(['packages/core/src/Storage.android.ts']))).toBe(false);
  });
  it('ignores tests and documentation, including shared-package tests', () => {
    for (const path of ['docs/release.md', 'apps/mobile/src/App.test.ts', 'packages/core/src/core.test.ts', 'apps/server/test/fixture.ts']) {
      expect(relevantFile(path, 'server', new Set())).toBe(false);
    }
  });
  it('resolves nested and workspace dependency graphs without unrelated lockfile churn', () => {
    const lock = { packages: {
      'apps/mobile': { dependencies: { ui: '1', core: '*' } }, 'packages/core': { version: '0.1.0', dependencies: { zod: '1' } },
      'node_modules/core': { link: true, resolved: 'packages/core' }, 'node_modules/ui': { version: '1', dependencies: { zod: '2' } },
      'node_modules/ui/node_modules/zod': { version: '2' }, 'node_modules/zod': { version: '1' }, 'node_modules/server': { version: '1' },
    } };
    const before = dependencyClosure(lock, 'apps/mobile');
    expect(Object.keys(before)).toContain('node_modules/ui/node_modules/zod'); expect(Object.keys(before)).toContain('packages/core');
    lock.packages['node_modules/server'].version = '2'; expect(dependencyClosure(lock, 'apps/mobile')).toEqual(before);
    lock.packages['node_modules/ui/node_modules/zod'].version = '3'; expect(dependencyClosure(lock, 'apps/mobile')).not.toEqual(before);
  });
  it('ignores web-only dependency versions/specifiers in a native dependency closure', () => {
    const lock = { packages: { 'apps/mobile': { dependencies: { idb: '1', ui: '1' } }, 'node_modules/idb': { version: '1' }, 'node_modules/ui': { version: '1' } } };
    const before = dependencyClosure(lock, 'apps/mobile', [], new Set(['idb']));
    lock.packages['apps/mobile'].dependencies.idb = '2'; lock.packages['node_modules/idb'].version = '2';
    expect(dependencyClosure(lock, 'apps/mobile', [], new Set(['idb']))).toEqual(before);
    expect(dependencyClosure(lock, 'apps/mobile')).not.toEqual(before);
  });
});

const temporary: string[] = [];
afterEach(() => { for (const dir of temporary.splice(0)) { expect(dir.startsWith(resolve(tmpdir(), 'little-say-plan-'))).toBe(true); rmSync(dir, { recursive: true, force: true }); } });
function fixture() {
  const dir = mkdtempSync(resolve(tmpdir(), 'little-say-plan-')); temporary.push(dir);
  git(['init', '--initial-branch=master'], dir); git(['config', 'user.name', 'Test'], dir); git(['config', 'user.email', 'test@example.invalid'], dir); git(['config', 'core.autocrlf', 'false'], dir);
  const docs = { 'release.json': { version: '0.2.0' }, 'package.json': { version: '0.2.0', scripts: { build: 'build both' } }, 'apps/server/package.json': { version: '0.2.0' },
    'package-lock.json': { version: '0.2.0', packages: { '': { version: '0.2.0' }, 'apps/server': { version: '0.2.0' }, 'apps/mobile': { version: '0.1.0' } } },
    'native-release.json': release, 'apps/mobile/package.json': { version: '0.1.0' }, 'apps/mobile/app.json': { expo: { version: '0.1.0' } } };
  for (const [p, value] of Object.entries(docs)) writeJson(resolve(dir, p), value);
  const write = (path: string, text: string) => { mkdirSync(dirname(resolve(dir, path)), { recursive: true }); writeFileSync(resolve(dir, path), text); };
  write('apps/mobile/src/App.tsx', 'shared'); write('apps/mobile/src/Entry.web.tsx', 'web'); write('apps/server/src/app.ts', 'api');
  git(['add', '.'], dir); git(['commit', '-m', 'base'], dir); return { dir, docs, write, source: git(['rev-parse', 'HEAD'], dir) };
}
describe('real Git snapshots and candidate contracts', () => {
  it('reproduces an account dependency landing between candidate validation and the version squash merge', () => {
    const { dir, docs } = fixture();
    Object.assign(docs['apps/mobile/package.json'], { name: 'app', description: 'App', private: true, main: 'index.js', license: 'UNLICENSED', dependencies: { expo: '~57.0.0' } });
    writeJson(resolve(dir, 'apps/mobile/package.json'), docs['apps/mobile/package.json']);
    git(['add', '.'], dir); git(['commit', '-m', 'baseline app metadata'], dir);
    const source = git(['rev-parse', 'HEAD'], dir);
    const plan = planRelease({ ...args(), source, previous: undefined, server: undefined });
    git(['switch', '-c', 'release-candidate'], dir);
    const after = releaseDocuments(docs, plan);
    for (const p of releaseFiles) writeJson(resolve(dir, p), after[p]);
    git(['add', '.'], dir); git(['commit', '-m', 'validated versions'], dir);
    const candidate = git(['rev-parse', 'HEAD'], dir);
    expect(() => validateCandidate(plan, candidate, dir)).not.toThrow();
    git(['switch', 'master'], dir);
    const mobile = { ...docs['apps/mobile/package.json'], dependencies: { expo: '~57.0.0', 'expo-apple-authentication': '~8.0.0' } };
    writeJson(resolve(dir, 'apps/mobile/package.json'), mobile);
    git(['add', '.'], dir); git(['commit', '-m', 'account dependency'], dir);
    git(['merge', '--squash', 'release-candidate'], dir);
    git(['add', '.'], dir); git(['commit', '-m', 'squashed versions on advanced base'], dir);
    const merged = git(['rev-parse', 'HEAD'], dir);
    expect(git(['rev-parse', `${merged}^{tree}`], dir)).not.toBe(git(['rev-parse', `${candidate}^{tree}`], dir));
    expect(() => validateCandidate(plan, merged, dir)).toThrow('unexpected metadata changes');
    expect(JSON.parse(git(['show', `${merged}:apps/mobile/package.json`], dir)).dependencies).toEqual(mobile.dependencies);
  });
  it('detects deletes/renames and reverts while ignoring documentation changes', () => {
    const { dir, write, source } = fixture(); const before = sourceInputs(source, 'server', dir);
    write('README.md', 'docs'); git(['add', '.'], dir); git(['commit', '-m', 'docs'], dir); expect(sourceInputs('HEAD', 'server', dir)).toBe(before);
    git(['mv', 'apps/server/src/app.ts', 'apps/server/src/server.ts'], dir); git(['commit', '-m', 'rename'], dir); expect(sourceInputs('HEAD', 'server', dir)).not.toBe(before);
    git(['revert', '--no-edit', 'HEAD'], dir); expect(sourceInputs('HEAD', 'server', dir)).toBe(before);
    write('apps/server/src/é.ts', 'unicode path input'); git(['add', '.'], dir); git(['commit', '-m', 'unicode source'], dir);
    expect(sourceInputs('HEAD', 'server', dir)).not.toBe(before); git(['revert', '--no-edit', 'HEAD'], dir);
    git(['rm', 'apps/server/src/app.ts'], dir); git(['commit', '-m', 'delete'], dir); expect(sourceInputs('HEAD', 'server', dir)).not.toBe(before);
  });
  it('ignores allocated versions but rejects any extra functional candidate change', () => {
    const { dir, docs, source, write } = fixture(); const before = sourceInputs(source, 'server', dir);
    const plan = planRelease({ ...args(), source, previous: undefined, server: undefined }); const after = releaseDocuments(docs, plan);
    for (const p of releaseFiles) writeJson(resolve(dir, p), after[p]);
    git(['add', '.'], dir); git(['commit', '-m', 'versions'], dir); const candidate = git(['rev-parse', 'HEAD'], dir);
    expect(() => validateCandidate(plan, candidate, dir)).not.toThrow(); expect(sourceInputs(candidate, 'server', dir)).toBe(before);
    write('apps/mobile/src/App.tsx', 'different product'); git(['add', '.'], dir); git(['commit', '-m', 'smuggled'], dir);
    expect(() => validateCandidate(plan, git(['rev-parse', 'HEAD'], dir), dir)).toThrow('non-version');
    expect(hash(after)).not.toBe(hash(docs));
  });
  it('does not select native bundles for web-only config or assets', () => {
    const { dir, source, write } = fixture(); const before = sourceInputs(source, 'android', dir);
    writeJson(resolve(dir, 'apps/mobile/app.json'), { expo: { version: '0.1.0', web: { name: 'New PWA name' } } });
    write('apps/mobile/assets/brand/favicon.png', 'new favicon'); git(['add', '.'], dir); git(['commit', '-m', 'web assets'], dir);
    expect(sourceInputs('HEAD', 'android', dir)).toBe(before); expect(sourceInputs('HEAD', 'server', dir)).not.toBe(sourceInputs(source, 'server', dir));
  });
});
