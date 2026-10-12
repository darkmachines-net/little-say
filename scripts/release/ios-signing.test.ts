/** @file Verifies Apple sign-in profile checks reject stale/malformed credentials and validate the selected distribution before publication. */

import { build } from '@expo/plist/build/build';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { graphqlClient } from './eas-credentials';
import { preflightCredentials } from './expo';
import { verifyAppleSignInProfile } from './ios-signing';

vi.mock('./eas-credentials', () => ({ graphqlClient: vi.fn() }));
let response: any;
function profile(entitlement: unknown = ['Default']): string {
  return Buffer.from(build({ Entitlements: { 'com.apple.developer.applesignin': entitlement } } as any)).toString('base64');
}
beforeEach(() => {
  response = { data: { app: { byId: {
    androidAppCredentials: [{ androidAppBuildCredentialsList: [{ isDefault: true, androidKeystore: { id: 'key' } }] }],
    iosAppCredentials: [{ appleAppIdentifier: { bundleIdentifier: 'net.darkmachines.littlesay' }, iosAppBuildCredentialsList: [
      { iosDistributionType: 'AD_HOC', distributionCertificate: { id: 'cert' }, provisioningProfile: { id: 'profile', expiration: '2099-01-01', provisioningProfile: profile() } },
    ] }],
  } } } };
  vi.mocked(graphqlClient).mockReturnValue({ query: () => ({ toPromise: async () => response }) } as any);
});
afterEach(() => vi.resetAllMocks());

it('accepts the Default Apple sign-in entitlement in an encoded profile', () => {
  expect(() => verifyAppleSignInProfile(profile())).not.toThrow();
});
it('reads the embedded plist without treating the signed binary envelope as XML', () => {
  const envelope = (encoded: string) => Buffer.concat([Buffer.from([0x30, 0x82, 0xff, 0x00, 0x3c]), Buffer.from(encoded, 'base64'), Buffer.from([0x00, 0xff, 0x3c])]).toString('base64');
  expect(() => verifyAppleSignInProfile(envelope(profile()))).not.toThrow();
  expect(() => verifyAppleSignInProfile(envelope(profile([])))).toThrow('lacks Sign In with Apple');
});
it.each([[], ['Other'], 'Default', true])('rejects a missing or malformed entitlement: %j', entitlement => {
  expect(() => verifyAppleSignInProfile(profile(entitlement))).toThrow('lacks Sign In with Apple');
});
it('rejects the original profile with no Apple entitlement', () => {
  const stale = Buffer.from(build({ Entitlements: { 'application-identifier': 'TEAM.net.darkmachines.littlesay' } })).toString('base64');
  expect(() => verifyAppleSignInProfile(stale)).toThrow('regenerate the selected profile');
});
it.each(['', 'bm90IGEgcHJvZmlsZQ=='])('rejects unreadable profiles without echoing their content', encoded => {
  expect(() => verifyAppleSignInProfile(encoded)).toThrow('Cannot decode');
});
it('preflights the actual internal signing profile and rejects stale credentials before a build', async () => {
  await expect(preflightCredentials('internal', ['ios'])).resolves.toBeUndefined();
  response.data.app.byId.iosAppCredentials[0].iosAppBuildCredentialsList[0].provisioningProfile.provisioningProfile = profile([]);
  await expect(preflightCredentials('internal', ['ios'])).rejects.toThrow('lacks Sign In with Apple');
});
it('does not use a valid store profile to excuse an invalid internal profile', async () => {
  const list = response.data.app.byId.iosAppCredentials[0].iosAppBuildCredentialsList;
  list.push({ ...list[0], iosDistributionType: 'APP_STORE' });
  list[0] = { ...list[0], provisioningProfile: { ...list[0].provisioningProfile, provisioningProfile: profile([]) } };
  await expect(preflightCredentials('internal', ['ios'])).rejects.toThrow('lacks Sign In with Apple');
});
it('requires an unambiguous, unexpired profile and leaves Android-only preflight independent', async () => {
  const list = response.data.app.byId.iosAppCredentials[0].iosAppBuildCredentialsList;
  list.push({ ...list[0] }); await expect(preflightCredentials('internal', ['ios'])).rejects.toThrow('one unexpired'); list.pop();
  list[0].provisioningProfile.expiration = '2000-01-01';
  await expect(preflightCredentials('internal', ['ios'])).rejects.toThrow('one unexpired');
  await expect(preflightCredentials('internal', ['android'])).resolves.toBeUndefined();
});
