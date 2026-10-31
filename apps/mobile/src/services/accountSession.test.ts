/** @file Verifies session restoration rejects anonymous accounts and discards retired backup preferences. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as native from './accountSession';
import * as web from './accountSession.web';

const values = vi.hoisted(() => new Map<string, string>());
vi.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
  getItemAsync: async (key: string) => values.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => { values.set(key, value); },
  deleteItemAsync: async (key: string) => { values.delete(key); },
}));
const key = 'little-say-firebase-account';
const session: native.AccountSession = {
  account: { id: '00000000-0000-4000-8000-000000000001', email: 'parent@example.test', displayName: 'Parent', emailVerified: true, providers: ['password'] },
  server: 'https://example.test', firebaseUid: 'parent',
  authConfig: { projectId: 'test-project', apiKey: 'public-key', appId: 'public-app', authDomain: 'example.test', providers: ['password'] },
};
beforeEach(() => {
  values.clear();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } });
});
afterEach(() => vi.unstubAllGlobals());

for (const [platform, adapter] of [['native', native], ['web', web]] as const) {
  it(`rejects a legacy anonymous ${platform} session`, async () => {
    values.set(key, JSON.stringify({ ...session, account: { ...session.account, email: null, providers: [] } }));
    expect(await adapter.loadAccountSession()).toBeNull();
  });
  it.each([true, false, undefined])(`restores ${platform} sign-in without the legacy backupEnabled=%s preference`, async backupEnabled => {
    values.set(key, JSON.stringify({ ...session, backupEnabled }));
    const restored = await adapter.loadAccountSession();
    expect(restored).toEqual(session);
    await adapter.saveAccountSession(restored);
    expect(values.get(key)).not.toContain('backupEnabled');
    expect(await adapter.loadAccountSession()).toEqual(session);
  });
}
