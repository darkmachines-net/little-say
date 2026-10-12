/** @file Explains known public provider prerequisites without contacting providers or inspecting secrets. */
import type { AuthConfig } from '@little-say/core';

/** Return an actionable unavailable reason, or null when the advertised provider can be attempted.
 * This checks public inputs, not whether remote provider setup or signed credentials actually work.
 */
export function providerUnavailable(provider: 'google.com' | 'apple.com', config: AuthConfig | null | undefined, platform: string, socialAvailable: boolean): string | null {
  const name = provider === 'apple.com' ? 'Apple' : 'Google';
  if (!config) return 'Account configuration is unavailable. Go back and retry, or continue without an account.';
  if (!config.providers.includes(provider)) return `${name} sign-in is not enabled on this server.`;
  if (!socialAvailable) return `${name} sign-in requires a development or release build. Email and guest access remain available.`;
  if (platform === 'web') return null;
  if (provider === 'google.com' && (!config.googleWebClientId || (platform === 'ios' && !config.googleIosClientId))) return 'Google sign-in needs public client configuration for this platform. Continue with another method or without an account.';
  if (provider === 'apple.com' && platform === 'android' && (!config.appleServiceId || !config.appleRedirectUri)) return 'Apple sign-in needs Android callback configuration. Continue with another method or without an account.';
  return null;
}
