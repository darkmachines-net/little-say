/** @file Ensures Expo Go email sign-in never loads the native Google module and explains unsupported actions. */
import { expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { executionEnvironment: 'storeClient' }, ExecutionEnvironment: { StoreClient: 'storeClient' } }));
vi.mock('react-native-nitro-google-signin', () => { throw new Error('Unsupported Google module loaded'); });
import { nativeCredential, socialAuthAvailable } from './firebaseProviders';
it('rejects social actions before importing any unavailable native module', async () => {
  expect(socialAuthAvailable()).toBe(false);
  const config = { projectId: 'demo-test', apiKey: 'key', appId: 'app', authDomain: 'localhost', providers: [] };
  await expect(nativeCredential('google.com', config)).rejects.toThrow('development build');
});
