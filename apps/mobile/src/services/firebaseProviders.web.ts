/** @file Supplies browser provider capability without importing native-only sign-in modules. */
export type SocialProvider = 'google.com';
/** Firebase browser popups implement Google authentication. */
export function socialAuthAvailable() { return true; }
/** Native credential acquisition is never used by the web adapter. */
export async function nativeCredential(..._args: unknown[]): Promise<never> { throw new Error('Use Firebase browser provider authentication.'); }
