import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { assert, root, writeJson } from './common';
import type { NativeRelease } from './native-contract';

// Keep this adapter paired with tools/eas-cli's lockfile. Never log GraphQL payloads:
// they contain signing keys. No signing credentials are passed to npm or prebuild.
function graphqlClient() {
  const require = createRequire(resolve(root, 'tools/eas-cli/package.json'));
  const base = resolve(root, 'tools/eas-cli/node_modules/eas-cli/build');
  const SessionManager = require(resolve(base, 'user/SessionManager.js')).default;
  const { createGraphqlClient } = require(resolve(base, 'commandUtils/context/contextUtils/createGraphqlClient.js'));
  const session = new SessionManager();
  const accessToken = session.getAccessToken();
  const sessionSecret = accessToken ? undefined : session.getSessionSecret();
  assert(accessToken || sessionSecret, 'Sign in with native:configure first.');
  return createGraphqlClient({ accessToken, sessionSecret });
}
export async function verifyExpoProject(release: NativeRelease) {
  const response = await graphqlClient().query('query Project($id: String!) { app { byId(appId: $id) { id fullName } } }', { id: release.expoProjectId }, { noRetry: true }).toPromise();
  assert(!response.error && response.data?.app?.byId?.id === release.expoProjectId && response.data.app.byId.fullName === `@${release.expoOwner}/little-say`, 'Linked Expo project must be owned by the configured account and have the little-say slug.');
}
export async function readExpoEnvironment(release: NativeRelease, environment: string): Promise<{ name: string; value: string; visibility: string; type: string }[]> {
  const require = createRequire(resolve(root, 'tools/eas-cli/package.json'));
  const { EnvironmentVariablesQuery } = require(resolve(root, 'tools/eas-cli/node_modules/eas-cli/build/graphql/queries/EnvironmentVariablesQuery.js'));
  try {
    return await EnvironmentVariablesQuery.byAppIdWithSensitiveAsync(graphqlClient(), { appId: release.expoProjectId, environment, includeFileContent: false });
  } catch { throw new Error('Could not read the linked project EAS environment. Check EAS authentication and project access.'); }
}
export async function downloadAndroidCredentials(release: NativeRelease, directory: string) {
  const client = graphqlClient();
  const query = `query NativeCredentials($projectId: String!, $applicationIdentifier: String!) {
    app { byId(appId: $projectId) { id androidAppCredentials(filter: { applicationIdentifier: $applicationIdentifier, legacyOnly: false }) {
      applicationIdentifier androidAppBuildCredentialsList { isDefault androidKeystore { keystore keystorePassword keyAlias keyPassword } }
    } } }
  }`;
  const response = await client.query(query, { projectId: release.expoProjectId, applicationIdentifier: 'net.darkmachines.littlesay' }, { noRetry: true }).toPromise();
  assert(!response.error && response.data?.app?.byId?.id === release.expoProjectId, 'Could not read signing credentials for the linked Expo project.');
  const apps = response.data.app.byId.androidAppCredentials.filter((app: any) => app.applicationIdentifier === 'net.darkmachines.littlesay');
  assert(apps.length === 1, 'Set up Android signing for this exact app with the pinned EAS credentials command (see release guide).');
  const choices = apps[0].androidAppBuildCredentialsList.filter((entry: any) => entry.isDefault);
  assert(choices.length === 1 && choices[0].androidKeystore, 'The Expo project needs one default Android signing credential.');
  const key = choices[0].androidKeystore;
  assert(['keystore', 'keystorePassword', 'keyAlias', 'keyPassword'].every(field => typeof key[field] === 'string' && key[field].length), 'Signing credential is incomplete.');
  const bytes = Buffer.from(key.keystore, 'base64');
  assert(bytes.length > 100 && bytes.toString('base64') === key.keystore, 'Invalid signing keystore.');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const keystorePath = resolve(directory, 'android.keystore');
  writeFileSync(keystorePath, bytes, { mode: 0o600 });
  const file = resolve(directory, 'credentials.json');
  writeJson(file, { android: { keystore: { keystorePath, keystorePassword: key.keystorePassword, keyAlias: key.keyAlias, keyPassword: key.keyPassword } } });
  return file;
}
