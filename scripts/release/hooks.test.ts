/** @file Exercises Little Say's declared shared-pipeline integration, platform input boundaries and credential-free application-hook environment. */
import { describe, expect, it, vi } from 'vitest';
import { baselineKey, configuredComponents, hashIdentity, planRelease, readConfig, resolveConfigurationValue, type ComponentObservation, type ReleaseBaseline } from '@mchartier/expo-release';
import { applicationHook, hookEnvironment, type HookRequest } from './hooks';
import { dependencyClosure, relevantFile, withoutVersions } from './app-inputs';
import { readJson, root, sourceEnvironment } from './source-common';
import { dirname, resolve } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const config = readConfig(root);
const source = { repository: config.repository, commit: 'a'.repeat(40), toolkitCommit: 'b'.repeat(40), origin: 'local' as const };
function observed(): ComponentObservation[] {
  return config.components.map(component => ({ id: component.id, identity: `${component.id}-input`,
    version: component.kind === 'server' ? '0.3.2' : '0.1.3',
    ...(component.kind === 'native' ? { versionCode: 4 } : {}),
    ...(component.kind !== 'server' ? { runtime: '0.1.3', environmentHash: 'c'.repeat(64) } : {}) }));
}
function previous(): ReleaseBaseline {
  const values = observed();
  return { components: Object.fromEntries(configuredComponents(config, 'internal').map(component => {
    const value = values.find(item => item.id === component.id)!;
    return [baselineKey(component, 'internal'), { ...value, identity: hashIdentity({ identity: value.identity,
      environment: component.compareEnvironment === false ? null : value.environmentHash ?? null }) }];
  })) };
}

describe('Little Say shared release contract', () => {
  it('takes the Android store destination from the committed EAS profile rather than a second literal', () => {
    const destination = config.components.find(component => component.id === 'android')!.submission;
    expect(resolveConfigurationValue(destination, root)).toEqual(readJson(resolve(root, 'apps/mobile/eas.json')).submit.production.android);
    const fixture = mkdtempSync(resolve(tmpdir(), 'little-say-destination-'));
    try {
      mkdirSync(resolve(fixture, 'apps/mobile'), { recursive: true });
      writeFileSync(resolve(fixture, 'apps/mobile/eas.json'), JSON.stringify({ submit: { production: { android: { track: 'beta', releaseStatus: 'draft' } } } }));
      expect(resolveConfigurationValue(destination, fixture)).toEqual({ track: 'beta', releaseStatus: 'draft' });
    } finally { expect(dirname(resolve(fixture))).toBe(resolve(tmpdir())); rmSync(fixture, { recursive: true, force: true }); }
  });
  // Selection is independent of the fresh-history version and build-number floors.
  it.each([
    ['no-op', [], []], ['server-only', ['server'], ['server']], ['android OTA', ['android.ota'], ['android.ota']],
    ['Android native', ['android'], ['android']], ['iOS native', ['ios'], ['ios']],
    ['environment-only', ['environment'], ['android', 'ios']],
    ['combined major', ['server', 'android', 'ios', 'android.ota', 'ios.ota'], ['android', 'android.ota', 'ios', 'ios.ota', 'server']],
  ] as const)('preserves %s selection', (name, changes, expected) => {
    const observations = observed();
    for (const observation of observations) {
      if ((changes as readonly string[]).includes(observation.id)) observation.identity = 'changed';
      if ((changes as readonly string[]).includes('environment') && observation.environmentHash) observation.environmentHash = 'd'.repeat(64);
    }
    const plan = planRelease({ config, source, origin: { kind: 'local' }, observations, baseline: previous(), profile: 'internal', bump: name === 'combined major' ? 'major' : 'patch' });
    expect(plan.selection.selected).toEqual(expected);
    if (name === 'Android native') {
      expect(plan.components.find(item => item.id === 'android')?.next).toEqual({ version: '0.1.5', versionCode: 6 });
      expect(plan.components.find(item => item.id === 'ios')?.next).toBeUndefined();
    }
    if (name === 'combined major') for (const target of ['android', 'ios']) {
      expect(plan.graph.stages.find(stage => stage.id === `${target}.ota:export`)?.needs).toContain(`${target}:build`);
      expect(plan.graph.stages.some(stage => stage.id === `${target}:submit`)).toBe(false);
    }
    if (name === 'android OTA') expect(plan.graph.stages.find(stage => stage.id === 'android.ota:publish')?.needs.some(id => plan.stages[id].action === 'deploy')).toBe(true);
  });
  it('keeps production client history independent while reusing the global server image', () => {
    const plan = planRelease({ config, source, origin: { kind: 'local' }, observations: observed(), baseline: previous(), profile: 'production' });
    expect(plan.selection.selected).toEqual(['android', 'android.ota', 'ios', 'ios.ota']);
    expect(plan.components.filter(item => item.kind === 'native').every(item => item.builder === 'eas' && item.runtimePolicy === 'appVersion')).toBe(true);
    expect(plan.graph.stages.some(stage => stage.id === 'android:submit')).toBe(true);
  });
  it('rejects inherited credentials and reserves wrapper-owned runtime/channel values', () => {
    expect(sourceEnvironment({ PATH: 'tools', EXPO_TOKEN: 'secret', GITHUB_TOKEN: 'secret', OPENAI_API_KEY: 'secret', NODE_OPTIONS: '--import=bad' })).toEqual({ PATH: 'tools' });
    const environment = hookEnvironment({ profile: 'internal', environment: { LITTLE_SAY_GOOGLE_IOS_URL_SCHEME: 'public-scheme' } });
    expect(environment).toMatchObject({ LITTLE_SAY_CHANNEL: 'internal', EXPO_NO_DOTENV: '1', LITTLE_SAY_GOOGLE_IOS_URL_SCHEME: 'public-scheme' });
    for (const key of ['OPENAI_API_KEY', 'NODE_OPTIONS', 'LITTLE_SAY_OTA_VERSIONS', 'EXPO_PUBLIC_API_URL']) expect(() => hookEnvironment({ profile: 'internal', environment: { [key]: 'value' } })).toThrow();
    expect(() => hookEnvironment({ profile: 'internal', environment: { LITTLE_SAY_CHANNEL: 'production' } })).toThrow();
  });
  it('verifies application metadata for server and older-runtime OTA artifacts without provider operations', async () => {
    const request: HookRequest = { schemaVersion: 1, action: 'verify', root, source, profile: 'internal', config };
    const server = readJson(resolve(root, 'release.json'));
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 'ok', version: server.version })));
    const serverArtifact = { kind: 'server', version: server.version, baseUrl: 'http://127.0.0.1:42123' };
    try {
      expect(await applicationHook({ ...request, target: 'server', artifact: serverArtifact })).toMatchObject({ verified: true });
      fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok', version: '0.0.0' })));
      await expect(applicationHook({ ...request, target: 'server', artifact: serverArtifact })).rejects.toThrow('Running server health/version');
      await expect(applicationHook({ ...request, target: 'server', artifact: { ...serverArtifact, baseUrl: 'https://example.invalid' } })).rejects.toThrow('isolated localhost');
    } finally { fetcher.mockRestore(); }
    await expect(applicationHook({ ...request, target: 'server', artifact: { kind: 'server', version: '0.0.0' } })).rejects.toThrow('Server artifact version');
    const release = readJson(resolve(root, 'native-release.json'));
    const runtimeOverrides = { version: '0.1.1', androidVersionCode: 2, iosBuildNumber: '1' };
    const artifact = { kind: 'expo-export', platform: 'android', runtime: runtimeOverrides.version,
      metadata: { expoConfig: { extra: { eas: { projectId: release.expoProjectId }, serverUrl: release.serverUrl } } } };
    expect(await applicationHook({ ...request, target: 'android.ota', runtimeOverrides, artifact })).toMatchObject({ verified: true });
    await expect(applicationHook({ ...request, target: 'android.ota', runtimeOverrides, artifact: { ...artifact, runtime: 'wrong' } })).rejects.toThrow('Export differs');
  });
});

describe('application input ownership', () => {
  it('separates native, web and platform overrides while ignoring tests', () => {
    const all = new Set(['apps/mobile/src/service.ts', 'apps/mobile/src/service.android.ts', 'apps/mobile/src/service.test.ts']);
    expect(relevantFile('apps/mobile/src/service.ts', 'android', all)).toBe(false);
    expect(relevantFile('apps/mobile/src/service.ts', 'ios', all)).toBe(true);
    expect(relevantFile('apps/mobile/src/service.test.ts', 'ios', all)).toBe(false);
    expect(relevantFile('apps/mobile/src/website/Home.tsx', 'android', all)).toBe(false);
    expect(relevantFile('apps/mobile/src/website/Home.tsx', 'server', all)).toBe(true);
    expect(relevantFile('apps/mobile/app.config.js', 'android', all)).toBe(false);
    expect(withoutVersions('native-release.json', { version: '1.0.0', androidVersionCode: 2, iosBuildNumber: '2', serverUrl: 'https://example.invalid' })).toEqual({ serverUrl: 'https://example.invalid' });
  });
  it('hashes the resolved workspace dependency graph without unrelated release tooling', () => {
    const packages = { 'apps/mobile': { dependencies: { shared: '*' } }, 'node_modules/shared': { link: true, resolved: 'packages/shared' },
      'packages/shared': { dependencies: { dependency: '1' } }, 'node_modules/dependency': { version: '1.0.0' }, 'node_modules/@mchartier/expo-release': { version: '2.0.0' } };
    expect(Object.keys(dependencyClosure({ packages }, 'apps/mobile')).sort()).toEqual(['apps/mobile', 'node_modules/dependency', 'node_modules/shared', 'packages/shared']);
  });
});
