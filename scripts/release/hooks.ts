/** @file Adapts Little Say source inputs, Expo fingerprints/exports, validation and local artifacts to the shared JSON hook protocol. */
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, git, mobile, node, npm, readJson, root, sourceEnvironment } from './source-common';
import { hash, sourceInputs } from './app-inputs';

export interface HookRequest {
  schemaVersion: 1; action: string; root: string; source: { commit: string }; profile: 'internal' | 'production';
  environment?: Record<string, string>; runtimeOverrides?: Record<string, unknown>; config: any; target?: any; artifact?: any; outputDirectory?: string; plan?: any; phase?: string;
  environmentHash?: string | null; componentEnvironments?: Record<string, { environment: Record<string, string>; hash: string | null }>;
  baseline?: { components?: Record<string, any> };
}

/** Resolve public build inputs while reserving project/version/channel values for the committed release contract. */
export function hookEnvironment(request: Pick<HookRequest, 'profile' | 'environment' | 'runtimeOverrides'>): NodeJS.ProcessEnv {
  assert(['internal', 'production'].includes(request.profile), 'Unknown release profile.');
  const values = request.environment || {};
  for (const [key, value] of Object.entries(values)) {
    assert(typeof value === 'string' && !/^(EXPO_PUBLIC_|AAC_OPENAI_KEY$|OPENAI_API_KEY$|NODE_OPTIONS$|EXPO_NO_DOTENV$|EAS_BUILD_|LITTLE_SAY_OTA_VERSIONS$|LITTLE_SAY_FINGERPRINT_PLATFORM$|EAS_SKIP_AUTO_FINGERPRINT$)/i.test(key), `Unsupported source variable ${key}.`);
    assert(key !== 'LITTLE_SAY_CHANNEL' || value === request.profile, 'Source channel differs from the selected profile.');
  }
  const result: NodeJS.ProcessEnv = { ...sourceEnvironment(), ...values, EXPO_NO_DOTENV: '1', CI: '1', LITTLE_SAY_CHANNEL: request.profile };
  if (request.runtimeOverrides && Object.keys(request.runtimeOverrides).length) result.LITTLE_SAY_OTA_VERSIONS = JSON.stringify(request.runtimeOverrides);
  return result;
}

/** Compute full or allocation-normalized compatibility through the same Expo policy used by EAS builds. */
export function nativeFingerprint(platform: 'android' | 'ios', environment: NodeJS.ProcessEnv, normalized = false): string {
  assert(!git(['ls-files', 'apps/mobile/android', 'apps/mobile/ios']), 'Generated native directories must remain untracked.');
  const env = normalized ? { ...environment, LITTLE_SAY_OTA_VERSIONS: JSON.stringify({ version: '0.0.0', androidVersionCode: 1, iosBuildNumber: '1' }) } : environment;
  const result = JSON.parse(node(resolve(root, 'node_modules/tsx/dist/cli.mjs'), [resolve(root, 'scripts/release/fingerprint.ts'), platform], { env, capture: true }));
  return normalized ? hash({ fingerprint: result.hash }) : result.hash;
}

/** Capture inert public Expo configuration before any build or publication credential is admitted. */
export function publicExpoConfig(environment: NodeJS.ProcessEnv) {
  return JSON.parse(node(resolve(root, 'node_modules/expo/bin/cli'), ['config', '--type', 'public', '--json'], { cwd: mobile, env: environment, capture: true }));
}

/** Observe app-specific source and native compatibility without credentials, provider calls or release mutations. */
export function inspectApplication(request: HookRequest) {
  assert(request.source.commit === git(['rev-parse', 'HEAD']), 'Inspect native inputs from the exact requested checkout.');
  const environment = hookEnvironment(request);
  const release = { ...readJson(resolve(root, 'native-release.json')), ...(request.runtimeOverrides || {}) };
  const eas = readJson(resolve(mobile, 'eas.json')); const profile = eas.build[request.profile];
  assert(eas.cli.version === '22.4.0' && eas.cli.appVersionSource === 'local' && eas.cli.requireCommit === true, 'EAS must use pinned tooling and committed versions.');
  assert(profile.channel === request.profile && profile.environment === (request.profile === 'internal' ? 'preview' : 'production') && profile.autoIncrement === false, 'EAS profile differs from the release contract.');
  assert(!profile.extends && JSON.stringify(profile.env) === JSON.stringify({ LITTLE_SAY_CHANNEL: request.profile }), 'EAS profile must use the canonical release environment.');
  const expoConfig = publicExpoConfig(environment);
  const environmentHash = request.environmentHash || hash(Object.entries(request.environment || {}).sort(([a], [b]) => a.localeCompare(b)));
  const observations: any[] = [{ id: 'server', identity: sourceInputs(request.source.commit, 'server'), version: readJson(resolve(root, 'release.json')).version }];
  for (const platform of ['android', 'ios'] as const) {
    const compatibilityIdentity = nativeFingerprint(platform, environment, true);
    const fingerprint = nativeFingerprint(platform, environment);
    observations.push({ id: platform, identity: compatibilityIdentity, compatibilityIdentity, fingerprint, environmentHash,
      runtime: release.version, version: release.version, versionCode: Number(platform === 'android' ? release.androidVersionCode : release.iosBuildNumber), releaseMetadata: release, expoConfig });
    observations.push({ id: `${platform}.ota`, identity: sourceInputs(request.source.commit, platform), compatibilityIdentity: undefined,
      fingerprint, environmentHash, runtime: release.version, releaseMetadata: release, expoConfig });
  }
  return { schemaVersion: 1, observations };
}

/** Dispatch only source operations; the shared CLI owns version preparation, provider transports, journals and recovery. */
export async function applicationHook(request: HookRequest) {
  assert(request.schemaVersion === 1 && resolve(request.root) === root, 'Unsupported hook protocol or checkout root.');
  if (request.action === 'inspect') return inspectApplication(request);
  if (request.action === 'validate') {
    const env = hookEnvironment(request);
    npm(['run', 'check'], { env }); npm(['run', 'test:services'], { env });
    return { schemaVersion: 1, checks: ['check', 'test:services'] };
  }
  const target = typeof request.target === 'string' ? request.config.components.find((item: any) => item.id === request.target) : request.target;
  if (request.action === 'verify' && target?.kind === 'server') {
    assert(request.artifact?.kind === 'server' && request.artifact.version === readJson(resolve(root, 'release.json')).version, 'Server artifact version differs from application metadata.');
    const baseUrl = new URL(request.artifact.baseUrl);
    assert(baseUrl.protocol === 'http:' && baseUrl.hostname === '127.0.0.1', 'Server verification needs the isolated localhost image.');
    const response = await fetch(new URL('/api/health', baseUrl), { signal: AbortSignal.timeout(5000), redirect: 'error' });
    const health = await response.json() as { status?: string; version?: string };
    assert(response.ok && health.status === 'ok' && health.version === request.artifact.version, 'Running server health/version differs from the artifact.');
    return { schemaVersion: 1, verified: true };
  }
  assert(target && ['android', 'ios'].includes(target.platform), 'Choose one native platform.');
  if (request.action === 'verify' && target.kind === 'ota') {
    const release = { ...readJson(resolve(root, 'native-release.json')), ...request.runtimeOverrides };
    const config = request.artifact?.metadata?.expoConfig;
    assert(request.artifact?.kind === 'expo-export' && request.artifact.platform === target.platform && request.artifact.runtime === release.version
      && config?.extra?.eas?.projectId === release.expoProjectId && config.extra.serverUrl === release.serverUrl, 'Export differs from Little Say runtime/project/server metadata.');
    return { schemaVersion: 1, verified: true };
  }
  if (request.action === 'build' && target.kind === 'ota') {
    assert(request.outputDirectory, 'The shared runner must provide a retained export destination.');
    const directory = resolve(request.outputDirectory); mkdirSync(directory, { recursive: true });
    node(resolve(root, 'node_modules/expo/bin/cli'), ['export', '--platform', target.platform, '--output-dir', directory], { cwd: mobile, env: hookEnvironment(request) });
    const expoConfig = publicExpoConfig(hookEnvironment(request));
    return { schemaVersion: 1, artifact: { kind: 'expo-export', directory, platform: target.platform,
      runtime: { ...readJson(resolve(root, 'native-release.json')), ...request.runtimeOverrides }.version, metadata: { expoConfig } } };
  }
  const { localNativeHook } = await import('./local-native');
  return localNativeHook({ ...request, target }, hookEnvironment(request));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = await applicationHook(JSON.parse(readFileSync(0, 'utf8'))); process.stdout.write(`${JSON.stringify(result)}\n`); }
  catch (error) { console.error(error instanceof Error ? error.message : 'Application hook failed.'); process.exitCode = 1; }
}
