/** @file Supplies browser provider capability without importing native-only sign-in modules. */
export type SocialProvider = 'google.com' | 'apple.com';
export type AppleGrant = { token: string; type: 'CODE' | 'ACCESS_TOKEN'; redirectUri?: string };
/** Firebase browser popups implement Google and Apple authentication. */
export function socialAuthAvailable() { return true; }
/** Native credential acquisition is never used by the web adapter. */
export async function nativeCredential(..._args: unknown[]): Promise<never> { throw new Error('Use Firebase browser provider authentication.'); }
