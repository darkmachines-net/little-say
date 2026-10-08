/** @file Simulates GHCR tag conflicts, lost push responses, multi-architecture readback, and stale latest promotion. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { git, readJson, run } from './common';
import { imageDigest, promoteImage, publishImage } from './image';
import type { Operation, ReleasePlan } from './contract';
import type { Journal } from './journal';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
vi.mock('./common', async original => ({ ...await original<typeof import('./common')>(), git: vi.fn(), readJson: vi.fn(), run: vi.fn() }));
const commit = 'a'.repeat(40), digest = `sha256:${'b'.repeat(64)}`, image = 'ghcr.io/test/app';
const plan = { serverVersion: '0.2.1', inputs: { server: 'input' } } as ReleasePlan;
let tags: Map<string, string>, operation: Operation<any> | undefined, journal: Journal, lostPush: boolean, gitTag: string, currentVersion: string, builds: number;
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('GITHUB_REPOSITORY', 'test/app'); vi.stubEnv('DEFAULT_BRANCH', 'master');
  tags = new Map(); operation = undefined; lostPush = false; gitTag = ''; currentVersion = plan.serverVersion; builds = 0;
  journal = { operation: () => operation, save: (state: any) => operation = { ...state, schema: 1, sequence: (operation?.sequence || 0) + 1 } } as unknown as Journal;
  vi.mocked(readJson).mockImplementation(() => ({ version: currentVersion }));
  vi.mocked(git).mockImplementation(args => {
    if (args[0] === 'ls-remote') return gitTag ? `${gitTag}\trefs/tags/v${plan.serverVersion}` : '';
    if (args[0] === 'push') gitTag = commit;
    if (args[0] === 'show') return JSON.stringify({ version: currentVersion }); return '';
  });
  vi.mocked(spawnSync).mockImplementation((_cmd, args: any) => ({ status: tags.has(args[3]) ? 0 : 1, stdout: tags.has(args[3]) ? `Digest: ${tags.get(args[3])}` : '', stderr: tags.has(args[3]) ? '' : 'manifest unknown' }) as any);
  vi.mocked(run).mockImplementation((_cmd, args) => {
    if (args[0] === 'buildx' && args[1] === 'build') { builds++; tags.set(`${image}:v${plan.serverVersion}`, digest); tags.set(`${image}:sha-${commit}`, digest); if (lostPush) throw Error('push response lost'); }
    if (args.includes('--raw')) return JSON.stringify({ manifests: ['amd64', 'arm64'].map(architecture => ({ platform: { os: 'linux', architecture }, digest: `sha256:${architecture}` })) });
    if (args[0] === 'image') return JSON.stringify({ 'org.opencontainers.image.source': 'https://github.com/test/app', 'org.opencontainers.image.version': plan.serverVersion, 'org.opencontainers.image.revision': commit });
    if (args[2] === 'create') tags.set(args[args.indexOf('--tag') + 1], args.at(-1)!.split('@')[1]);
    return '';
  });
});
afterEach(() => vi.unstubAllEnvs());
describe('immutable image publication', () => {
  it('publishes both architectures once, repairs a missing alias, and promotes only when finalized', () => {
    const receipt = publishImage(plan, commit, journal); expect(builds).toBe(1); expect(tags.has(`${image}:latest`)).toBe(false);
    tags.delete(`${image}:sha-${commit}`); expect(publishImage(plan, commit, journal)).toEqual(receipt); expect(builds).toBe(1);
    expect(tags.get(`${image}:sha-${commit}`)).toBe(digest); promoteImage(receipt); expect(tags.get(`${image}:latest`)).toBe(digest);
    expect(vi.mocked(run).mock.calls.filter(([, args]) => args[0] === 'pull').some(([, args]) => args.includes('linux/arm64'))).toBe(true);
  });
  it('reconciles registry success after a lost build-push response', () => {
    lostPush = true; expect(() => publishImage(plan, commit, journal)).toThrow('response lost');
    expect(publishImage(plan, commit, journal).digest).toBe(digest); expect(builds).toBe(1);
  });
  it('rejects conflicting Git/image tags and changed previously verified content', () => {
    gitTag = 'c'.repeat(40); expect(() => publishImage(plan, commit, journal)).toThrow('another commit'); expect(builds).toBe(0);
    gitTag = ''; publishImage(plan, commit, journal); tags.set(`${image}:sha-${commit}`, `sha256:${'c'.repeat(64)}`);
    expect(() => publishImage(plan, commit, journal)).toThrow('tags conflict');
    tags.set(`${image}:v${plan.serverVersion}`, `sha256:${'c'.repeat(64)}`);
    expect(() => publishImage(plan, commit, journal)).toThrow('Previously verified'); expect(builds).toBe(1);
  });
  it('does not interpret registry authorization/network failure as a missing image', () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 1, stderr: 'unauthorized', stdout: '' } as any);
    expect(() => imageDigest(`${image}:v0.2.1`)).toThrow(); expect(builds).toBe(0);
  });
  it('does not let an older retry move latest after a newer server version is prepared', () => {
    const receipt = publishImage(plan, commit, journal); currentVersion = '0.2.2';
    expect(() => promoteImage(receipt)).toThrow('newer server'); expect(tags.has(`${image}:latest`)).toBe(false);
  });
});
