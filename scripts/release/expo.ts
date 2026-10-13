/** @file Provides pinned EAS reads, reproducible configuration, native fingerprints, and verified runtime export environments. */

import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { assert, git, mobile, node, readJson, root, safeEnvironment, sourceEnvironment } from './common';
import { graphqlClient, readExpoEnvironment, verifyExpoProject } from './eas-credentials';
import { validateExpoEnvironment } from './environment';
import { profileConfig, releaseConfig, verifyOta, type Baseline, type NativeRelease, type Platform, type Profile } from './native-contract';
import { type NativeBuildBaseline, validateCloudBaseline } from './contract';
import { hash } from './inputs';
import { verifyAppleSignInProfile } from './ios-signing';

const cli = resolve(root, 'tools/eas-cli/node_modules/eas-cli/bin/run');

/** Invoke the locked EAS CLI in the app workspace; never install or select an unspecified latest CLI. */
export function eas(args: string[], env = safeEnvironment()): string {
  assert(readJson(resolve(root, 'tools/eas-cli/node_modules/eas-cli/package.json')).version === '22.4.0', 'Install the locked EAS CLI.');
  const platform = args[args.indexOf('--platform') + 1];
  if (['android', 'ios'].includes(platform)) env = { ...env, LITTLE_SAY_FINGERPRINT_PLATFORM: platform };
  return node(cli, args, { cwd: mobile, env, capture: true });
}

/** Read and validate the selected remote environment without logging credential or environment values. */
export async function expoEnvironment(profile: Profile) {
  const release = releaseConfig();
  await verifyExpoProject(release);
  return validateExpoEnvironment(profile, await readExpoEnvironment(release, profileConfig(profile).environment));
}

/** Set only target version metadata, keeping all current identity and environment inputs intact. */
export function versionEnvironment(env: NodeJS.ProcessEnv, release: Pick<NativeRelease, 'version' | 'androidVersionCode' | 'iosBuildNumber'>): NodeJS.ProcessEnv {
  return { ...env, LITTLE_SAY_OTA_VERSIONS: JSON.stringify({ version: release.version, androidVersionCode: release.androidVersionCode, iosBuildNumber: release.iosBuildNumber }) };
}

/** Compute the same full native fingerprint used by local builds; normalization is only for planning comparisons. */
export function nativeFingerprint(platform: Platform, env: NodeJS.ProcessEnv, normalized = false): string {
  assert(!git(['ls-files', 'apps/mobile/android', 'apps/mobile/ios']), 'Generated native directories must remain untracked.');
  const actual = normalized ? versionEnvironment(env, { version: '0.0.0', androidVersionCode: 1, iosBuildNumber: '1' }) : env;
  const fingerprint = JSON.parse(node(resolve(root, 'node_modules/tsx/dist/cli.mjs'), [resolve(root, 'scripts/release/fingerprint.ts'), platform], { env: sourceEnvironment(actual), capture: true })).hash;
  return normalized ? hash({ fingerprint }) : fingerprint;
}

/** Resolve the platform runtime with Expo's own managed-workflow resolver, using the exact allocated build environment. */
export function nativeRuntime(platform: Platform, env: NodeJS.ProcessEnv): string {
  const result = JSON.parse(node(resolve(root, 'node_modules/expo-updates/bin/cli.js'), ['runtimeversion:resolve', '--platform', platform, '--workflow', 'managed'], { cwd: mobile, env: sourceEnvironment({ ...env, LITTLE_SAY_FINGERPRINT_PLATFORM: platform }), capture: true }));
  assert(/^[a-f0-9]{40,64}$/.test(result.runtimeVersion), 'Expo did not resolve a fingerprint runtime.');
  return result.runtimeVersion;
}

/** Resolve legacy retained local artifacts with the same target-version and native fingerprint proof as CI OTA. */
export function localOtaEnvironment(b: Baseline, profile: Profile, remote: { env: NodeJS.ProcessEnv; hash: string }): NodeJS.ProcessEnv {
  const current = releaseConfig();
  for (const key of ['expoProjectId', 'expoOwner', 'serverUrl'] as const) assert(current[key] === b.release[key], 'OTA project/server identity differs.');
  const env = versionEnvironment(remote.env, b.release);
  verifyOta(b, { release: b.release, fingerprint: nativeFingerprint(b.platform, env), environmentHash: remote.hash, platform: b.platform, profile });
  if (b.runtimePolicy === 'fingerprint') assert(nativeRuntime(b.platform, env) === b.runtimeVersion, 'Local runtime differs from the retained native build.');
  return env;
}

/** Resolve an OTA baseline only after identity, environment, compatibility, full fingerprint, and ancestry proof. */
export function otaEnvironment(b: NativeBuildBaseline, profile: Profile, remote: { env: NodeJS.ProcessEnv; hash: string }): NodeJS.ProcessEnv {
  validateCloudBaseline(b);
  assert(b.profile === profile && b.environmentHash === remote.hash, 'OTA profile/environment differs from its build.');
  const current = releaseConfig();
  for (const key of ['expoProjectId', 'expoOwner', 'serverUrl'] as const) assert(current[key] === b.release[key], 'OTA project/server identity differs.');
  git(['merge-base', '--is-ancestor', b.commit, 'HEAD']);
  assert(nativeFingerprint(b.platform, remote.env, true) === b.compatibility, 'Native compatibility changed.');
  const env = versionEnvironment(remote.env, b.release);
  assert(nativeFingerprint(b.platform, env) === b.fingerprint, 'Full native fingerprint differs for target runtime.');
  if (b.schema === 3) assert(nativeRuntime(b.platform, env) === b.runtimeVersion, 'Resolved fingerprint runtime differs from the verified build.');
  return env;
}

/** Export the actual platform bundle with declared source inputs and no inherited publication tokens. */
export function exportBundle(platform: Platform, directory: string, env: NodeJS.ProcessEnv): void {
  node(resolve(root, 'node_modules/expo/bin/cli'), ['export', '--platform', platform, '--output-dir', directory], { cwd: mobile, env: sourceEnvironment(env) });
}

/** Read build-associated submissions through the pinned adapter; EAS submit has no JSON output flag. */
export async function buildWithSubmissions(id: string): Promise<any> {
  const require = createRequire(resolve(root, 'tools/eas-cli/package.json'));
  const base = resolve(root, 'tools/eas-cli/node_modules/eas-cli/build');
  const SessionManager = require(resolve(base, 'user/SessionManager.js')).default;
  const session = new SessionManager();
  const { createGraphqlClient } = require(resolve(base, 'commandUtils/context/contextUtils/createGraphqlClient.js'));
  const client = createGraphqlClient({ accessToken: session.getAccessToken(), sessionSecret: session.getAccessToken() ? undefined : session.getSessionSecret() });
  return require(resolve(base, 'graphql/queries/BuildQuery.js')).BuildQuery.withSubmissionsByIdAsync(client, id, { useCache: false });
}

/** Read a channel's sole branch mapping; release orchestration does not silently replace paused channels or rollouts. */
export async function channelBranch(profile: Profile): Promise<{ id: string; name: string }> {
  const require = createRequire(resolve(root, 'tools/eas-cli/package.json'));
  const query = require(resolve(root, 'tools/eas-cli/node_modules/eas-cli/build/graphql/queries/ChannelQuery.js')).ChannelQuery;
  const channel = await query.viewUpdateChannelAsync(graphqlClient(), { appId: releaseConfig().expoProjectId, channelName: profile });
  const mapping = JSON.parse(channel.branchMapping);
  assert(!channel.isPaused && channel.updateBranches.length === 1 && mapping.data?.length === 1 && mapping.data[0].branchMappingLogic === 'true', 'Channel must have one active, unconditional branch mapping before release.');
  const branch = channel.updateBranches[0];
  assert(mapping.data[0].branchId === branch.id, 'Channel branch mapping conflicts.');
  return { id: branch.id, name: branch.name };
}

/** Fetch raw update manifests for payload, source, environment, and branch verification. */
export async function updateGroup(groupId: string): Promise<any[]> {
  const require = createRequire(resolve(root, 'tools/eas-cli/package.json'));
  return require(resolve(root, 'tools/eas-cli/node_modules/eas-cli/build/graphql/queries/UpdateQuery.js')).UpdateQuery.viewUpdateGroupAsync(graphqlClient(), { groupId });
}

/** Resolve authenticated download locations for an update's exact asset keys; callers must not log signed URLs or headers. */
export async function updateAssetUrls(updateId: string, storageKeys: string[]): Promise<{ storageKey: string; url: string; headers: Record<string, string> }[]> {
  const require = createRequire(resolve(root, 'tools/eas-cli/package.json'));
  return require(resolve(root, 'tools/eas-cli/node_modules/eas-cli/build/graphql/queries/AssetQuery.js')).AssetQuery.getSignedUrlsAsync(graphqlClient(), updateId, storageKeys);
}

/** List raw update groups; the human-readable EAS CLI list truncates and decorates messages, so it cannot reconcile IDs. */
export async function updateGroups(branchName: string, platform: Platform, runtime: string, offset: number): Promise<any[][]> {
  const require = createRequire(resolve(root, 'tools/eas-cli/package.json'));
  return require(resolve(root, 'tools/eas-cli/node_modules/eas-cli/build/graphql/queries/UpdateQuery.js')).UpdateQuery.viewUpdateGroupsOnBranchAsync(graphqlClient(), {
    appId: releaseConfig().expoProjectId, branchName, offset, limit: 50, filter: { platform: platform.toUpperCase(), runtimeVersions: [runtime] },
  });
}

/** Verify signing/submission records and the selected iOS profile's Apple sign-in entitlement; keep profile contents in memory without logging them. */
export async function preflightCredentials(profile: Profile, selected: Platform[]): Promise<void> {
  if (!selected.length) return;
  const release = releaseConfig();
  const response = await graphqlClient().query(`query ReleaseCredentials($id: String!) {
    app { byId(appId: $id) {
      androidAppCredentials(filter: { applicationIdentifier: "net.darkmachines.littlesay", legacyOnly: false }) {
        androidAppBuildCredentialsList { isDefault androidKeystore { id } }
        googleServiceAccountKeyForSubmissions { id }
      }
      iosAppCredentials {
        appleAppIdentifier { bundleIdentifier }
        appStoreConnectApiKeyForSubmissions { id }
        iosAppBuildCredentialsList { iosDistributionType distributionCertificate { id } provisioningProfile { id expiration provisioningProfile } }
      }
    } }
  }`, { id: release.expoProjectId }, { noRetry: true }).toPromise();
  assert(!response.error && response.data?.app?.byId, 'Cannot verify EAS signing prerequisites. Complete native onboarding first.');
  const app = response.data.app.byId;
  if (selected.includes('android')) {
    const record = app.androidAppCredentials[0];
    assert(app.androidAppCredentials.length === 1 && record.androidAppBuildCredentialsList.filter((c: any) => c.isDefault && c.androidKeystore?.id).length === 1, 'Configure one default Android signing credential in EAS.');
    if (profile === 'production') assert(record.googleServiceAccountKeyForSubmissions?.id, 'Configure Play submission credentials in EAS.');
  }
  if (selected.includes('ios')) {
    const records = app.iosAppCredentials.filter((r: any) => r.appleAppIdentifier?.bundleIdentifier === 'net.darkmachines.littlesay');
    assert(records.length === 1, 'Configure iOS signing for the Little Say bundle identifier.');
    const kind = profile === 'internal' ? 'AD_HOC' : 'APP_STORE';
    const credentials = records[0].iosAppBuildCredentialsList.filter((c: any) => c.iosDistributionType === kind);
    assert(credentials.length === 1 && credentials[0].distributionCertificate?.id && credentials[0].provisioningProfile?.id && Date.parse(credentials[0].provisioningProfile.expiration) > Date.now(), `Configure one unexpired ${kind} iOS signing credential in EAS.`);
    verifyAppleSignInProfile(credentials[0].provisioningProfile.provisioningProfile);
    if (profile === 'production') {
      assert(records[0].appStoreConnectApiKeyForSubmissions?.id, 'Configure App Store Connect submission credentials in EAS.');
      assert(/^\d+$/.test(readJson(resolve(mobile, 'eas.json')).submit.production.ios.ascAppId || ''), 'Set submit.production.ios.ascAppId before production releases.');
    }
  }
}
