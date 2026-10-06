/** @file Ensures Expo Go email/guest startup never loads native social modules and explains unsupported actions. */
import { expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { executionEnvironment: 'storeClient' }, ExecutionEnvironment: { StoreClient: 'storeClient' } }));
vi.mock('expo-crypto', () => ({}));
vi.mock('react-native-nitro-google-signin', () => { throw new Error('Unsupported Google module loaded'); });
vi.mock('@invertase/react-native-apple-authentication', () => { throw new Error('Unsupported Apple module loaded'); });
import { nativeCredential, socialAuthAvailable } from './firebaseProviders';
it('rejects social actions before importing any unavailable native module', async () => {
  expect(socialAuthAvailable()).toBe(false);
  const config = { projectId: 'demo-test', apiKey: 'key', appId: 'app', authDomain: 'localhost', providers: [] };
  for (const provider of ['google.com', 'apple.com'] as const) await expect(nativeCredential(provider, config)).rejects.toThrow('development build');
});
