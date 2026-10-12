/** @file Checks the Apple sign-in entitlement in EAS provisioning profiles before spending a cloud build. */

import { parse } from '@expo/plist/build/parse';
import { assert } from './common';

/** Inspect the XML inside an EAS profile's signed envelope in memory; require Apple sign-in without logging or persisting credential/device data. This does not verify its signature. */
export function verifyAppleSignInProfile(encoded: string): void {
  let profile: any;
  try {
    assert(typeof encoded === 'string' && encoded.length > 0, 'Missing profile.');
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    // Provisioning profiles wrap the XML in CMS binary data, which is not valid XML.
    const start = decoded.indexOf('<plist');
    const end = decoded.indexOf('</plist>', start);
    assert(start >= 0 && end > start, 'Missing embedded plist.');
    profile = parse(decoded.slice(start, end + '</plist>'.length));
  } catch {
    throw new Error('Cannot decode the EAS iOS provisioning profile. Refresh it with EAS credentials:configure-build before releasing; see docs/releases.md for signing and Apple login recovery.');
  }
  const entitlement = profile?.Entitlements?.['com.apple.developer.applesignin'];
  assert(Array.isArray(entitlement) && entitlement.includes('Default'), 'The EAS iOS provisioning profile lacks Sign In with Apple (com.apple.developer.applesignin). Use EAS credentials:configure-build to regenerate the selected profile, retaining the existing certificate and devices, before retrying; see docs/releases.md for signing and Apple login recovery.');
}
