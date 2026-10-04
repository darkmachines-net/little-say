import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { cleanCommit, git, parseArgs, readJson, root, safeEnvironment, sha256, writeJson } from './common';
import { bump, checkVersions, prepare, serverDocuments, serverFiles, validateCommit, validateServerChange } from './version';
import { type Baseline, type NativeRelease, verifyArtifacts, verifyOta } from './native-contract';
import { validateExpoEnvironment } from './environment';
import { deployImage, immutableImage } from './deploy';

const temporary: string[] = [];
function temp() { const dir = mkdtempSync(resolve(tmpdir(), 'little-say-release-test-')); temporary.push(dir); return dir; }
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function documents() {
  return {
    'release.json': { version: '0.1.0' },
    'package.json': { name: 'workspace', version: '0.1.0', scripts: { test: 'vitest' } },
    'apps/server/package.json': { version: '0.1.0', dependencies: { fastify: '5' } },
    'package-lock.json': { version: '0.1.0', packages: { '': { version: '0.1.0' }, 'apps/server': { version: '0.1.0' }, 'apps/mobile': { version: '0.1.0' } } },
  };
}
function fixture() {
  const dir = temp();
  git(['init', '--initial-branch=main'], dir);
  git(['config', 'user.name', 'Release test'], dir); git(['config', 'user.email', 'test@example.invalid'], dir);
  git(['config', 'core.autocrlf', 'false'], dir);
  for (const [file, doc] of Object.entries(documents())) writeJson(resolve(dir, file), doc);
  writeJson(resolve(dir, 'native-release.json'), { version: '0.1.0', androidVersionCode: 1, iosBuildNumber: '1' });
  writeJson(resolve(dir, 'apps/mobile/package.json'), { version: '0.1.0' });
  writeJson(resolve(dir, 'apps/mobile/app.json'), { expo: { version: '0.1.0' } });
  git(['add', '.'], dir); git(['commit', '-m', 'initial'], dir); return dir;
}
const native: NativeRelease = { version: '0.1.0', androidVersionCode: 1, iosBuildNumber: '1', expoOwner: 'test', expoProjectId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', serverUrl: 'https://example.invalid' };
function baseline(commit: string): Baseline { return { schema: 1, commit, platform: 'android', profile: 'internal', channel: 'internal', environment: 'preview', release: native, fingerprint: 'a'.repeat(40), environmentHash: 'b'.repeat(64), artifacts: [{ file: 'app.apk', sha256: 'c'.repeat(64) }], createdAt: new Date(0).toISOString() }; }

describe('independent version ownership', () => {
  it('keeps checked-in versions consistent', () => checkVersions());
  it.each([['patch', '1.2.4'], ['minor', '1.3.0'], ['major', '2.0.0']])('bumps %s', (part, result) => expect(bump('1.2.3', part)).toBe(result));
  it('rejects invalid or prerelease versions', () => { expect(() => bump('1.2.3-rc.1', 'patch')).toThrow(); expect(() => bump('1.2.3', 'surprise')).toThrow(); });
  it('prepares a server-only commit and validates the committed transition', () => {
    const dir = fixture(); const before = readFileSync(resolve(dir, 'native-release.json'), 'utf8');
    prepare('server', 'minor', dir); checkVersions(dir);
    expect(readFileSync(resolve(dir, 'native-release.json'), 'utf8')).toBe(before);
    git(['add', '.'], dir); git(['commit', '-m', 'release server'], dir);
    expect(validateCommit(cleanCommit(dir), dir)).toBe('0.2.0');
  });
  it('allocates native version/build numbers without changing server version', () => {
    const dir = fixture(); prepare('native', 'patch', dir);
    expect(readJson(resolve(dir, 'native-release.json'))).toMatchObject({ version: '0.1.1', androidVersionCode: 2, iosBuildNumber: '2' });
    expect(readJson(resolve(dir, 'release.json')).version).toBe('0.1.0'); checkVersions(dir);
  });
  it('rejects a release smuggling dependency or source changes', () => {
    const before = documents(); const after = serverDocuments(before, '0.1.1');
    after['apps/server/package.json'].dependencies.fastify = '6';
    expect(() => validateServerChange(before, after, serverFiles)).toThrow('other than');
    expect(() => validateServerChange(before, serverDocuments(before, '0.1.1'), [...serverFiles, 'apps/server/src/app.ts'])).toThrow('only');
    expect(() => validateServerChange(before, serverDocuments(before, '1.9.9'), serverFiles)).toThrow('increment');
  });
  it('blocks dirty and untracked source before release work', () => {
    const dir = fixture(); writeFileSync(resolve(dir, 'forgotten.ts'), 'source');
    expect(() => prepare('server', 'patch', dir)).toThrow('Untracked');
    expect(readJson(resolve(dir, 'release.json')).version).toBe('0.1.0');
  });
});
describe('native and OTA baseline proof', () => {
  it('permits a JS-only descendant but rejects unrelated ancestry and changed native inputs', () => {
    const dir = fixture(); const original = cleanCommit(dir); const b = baseline(original);
    writeFileSync(resolve(dir, 'app.ts'), 'new UI'); git(['add', '.'], dir); git(['commit', '-m', 'JS update'], dir);
    const current = { release: native, fingerprint: b.fingerprint, environmentHash: b.environmentHash, platform: 'android' as const, profile: 'internal' as const };
    expect(() => verifyOta(b, current, dir)).not.toThrow();
    expect(() => verifyOta(b, { ...current, fingerprint: 'changed' }, dir)).toThrow('Native dependencies');
    expect(() => verifyOta(b, { ...current, environmentHash: 'changed' }, dir)).toThrow('EAS environment');
    expect(() => verifyOta(b, { ...current, release: { ...native, serverUrl: 'https://different.invalid' } }, dir)).toThrow('server changed');
    expect(() => verifyOta(b, { ...current, profile: 'production' }, dir)).toThrow('platform/profile');
    expect(() => verifyOta({ ...b, commit: '0'.repeat(40) }, current, dir)).toThrow();
  });
  it('detects modified, missing, or escaping artifacts before submission', () => {
    const dir = temp(); const file = resolve(dir, 'app.apk'); writeFileSync(file, 'signed artifact');
    const b = baseline('a'.repeat(40)); b.artifacts[0].sha256 = sha256(file);
    expect(() => verifyArtifacts(b, dir)).not.toThrow();
    writeFileSync(file, 'tampered'); expect(() => verifyArtifacts(b, dir)).toThrow('missing or changed');
    b.artifacts[0].file = '../outside.apk'; expect(() => verifyArtifacts(b, dir)).toThrow('inside');
  });
  it('removes backend secrets and development URLs from native process environments', () => {
    expect(safeEnvironment({ AAC_OPENAI_KEY: 'secret', OPENAI_API_KEY: 'secret', EXPO_PUBLIC_API_URL: 'http://lan', PATH: 'path', EXPO_TOKEN: 'eas-token' })).toEqual({ PATH: 'path', EXPO_TOKEN: 'eas-token' });
  });
  it('checks EAS values without exposing values in errors', () => {
    const v = { name: 'LITTLE_SAY_CHANNEL', value: 'internal', type: 'STRING', visibility: 'PUBLIC' };
    expect(validateExpoEnvironment('internal', [v]).env.LITTLE_SAY_CHANNEL).toBe('internal');
    expect(() => validateExpoEnvironment('production', [v])).toThrow('different');
    for (const changed of [{ name: 'OPENAI_API_KEY' }, { name: 'EXPO_PUBLIC_API_URL' }, { visibility: 'SECRET' }, { type: 'FILE_BASE64' }]) {
      expect(() => validateExpoEnvironment('internal', [{ ...v, value: 'never-log-me', ...changed }])).toThrow();
      try { validateExpoEnvironment('internal', [{ ...v, value: 'never-log-me', ...changed }]); } catch (error) { expect(String(error)).not.toContain('never-log-me'); }
    }
  });
});
describe('publication boundary', () => {
  it('accepts only immutable deployment references', () => {
    expect(immutableImage('ghcr.io/org/app', `sha256:${'a'.repeat(64)}`)).toBe(`ghcr.io/org/app@sha256:${'a'.repeat(64)}`);
    for (const input of ['latest', 'v0.1.0', 'sha256:abc', 'sha256:' + 'g'.repeat(64)]) expect(() => immutableImage('ghcr.io/org/app', input)).toThrow();
  });
  it('uses manual server publication and propagates reusable-workflow permissions', () => {
    const workflow = (name: string) => parse(readFileSync(resolve(root, '.github/workflows', name), 'utf8'));
    const cut = workflow('cut-server-release.yml'); const publish = workflow('publish-server-image.yml');
    expect(Object.keys(cut.on)).toEqual(['workflow_dispatch']);
    expect(Object.keys(publish.on).sort()).toEqual(['workflow_call', 'workflow_dispatch']);
    expect(cut.jobs.publish.permissions.packages).toBe('write'); expect(publish.jobs.publish.permissions.packages).toBe('write');
    expect(publish.concurrency['cancel-in-progress']).toBe(false);
    expect(publish.jobs.publish.steps.find((s: any) => s.uses?.startsWith('docker/build-push-action')).with.platforms).toBe('linux/amd64,linux/arm64');
    for (const file of ['ci.yml', 'cut-server-release.yml', 'publish-server-image.yml']) {
      const doc = workflow(file);
      expect(JSON.stringify(doc)).not.toMatch(/eas (build|submit|update)|server:deploy|EXPO_TOKEN|OPENAI_API_KEY|SELF_HOSTED/);
      for (const job of Object.values(doc.jobs) as any[]) for (const step of job.steps || []) if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
    }
  });
  it('rejects misspelled release options', () => expect(() => parseArgs(['--publish-now'], ['dry-run'])).toThrow('Unknown'));
  it.each([true, false])('verifies deployment, restoring the previous image only when public health fails (healthy=%s)', async healthy => {
    const directory = temp(); const calls: { args: string[]; image?: string }[] = []; let replaced = false;
    const target = { Id: 'new-image-id', Config: { Labels: { 'org.opencontainers.image.version': '0.1.1', 'org.opencontainers.image.revision': 'a'.repeat(40) } } };
    const runner = (_: string, args: string[], options: any) => {
      calls.push({ args, image: options.env?.LITTLE_SAY_SERVER_IMAGE });
      if (args.includes('compose') && args.includes('ps')) return replaced ? 'new-container' : 'old-container';
      if (args.includes('compose') && args.includes('up')) { replaced = true; return ''; }
      if (args.includes('image') && args.includes('inspect')) return JSON.stringify([target]);
      if (args.includes('inspect')) return JSON.stringify([args.includes('old-container') ? { Image: 'old-image-id' } : { Image: target.Id, State: { Health: { Status: 'healthy' } } }]);
      return '';
    };
    const receipt = resolve(directory, 'receipt.json');
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: 'ok', version: healthy ? '0.1.1' : '0.1.0' }))) as unknown as typeof fetch;
    const operation = deployImage({ context: 'test-host', project: 'test-project', image: 'ghcr.io/org/app', serverUrl: 'https://example.invalid', envFile: resolve(directory, '.env') }, 'ghcr.io/org/app@sha256:' + 'a'.repeat(64), '0.1.1', { run: runner, fetch: fetcher, receipt });
    if (healthy) { await operation; expect(readJson(receipt).version).toBe('0.1.1'); }
    else await expect(operation).rejects.toThrow('Public health');
    const ups = calls.filter(call => call.args.includes('up'));
    expect(ups).toHaveLength(healthy ? 1 : 2);
    if (!healthy) expect(ups[1].image).toBe('old-image-id');
    expect(calls.some(call => call.args.includes('down') || call.args.includes('--volumes') || call.args.includes('build'))).toBe(false);
    expect(calls.every(call => call.args[0] === '--context' && call.args[1] === 'test-host')).toBe(true);
  });
});
