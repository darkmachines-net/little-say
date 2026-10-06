/** @file Verifies native auth persistence commits atomically, bounds OS-store values, and removes credentials on sign-out. */
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ values: new Map<string, string>(), writes: 0, failAt: 0 }));
vi.mock('firebase/auth', () => ({ getReactNativePersistence: (storage: unknown) => storage }));
vi.mock('expo-crypto', () => ({ randomUUID: () => crypto.randomUUID(), CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digestStringAsync: async (_algorithm: string, value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('') }));
vi.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
  getItemAsync: async (key: string) => state.values.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => { state.writes++; if (state.writes === state.failAt) throw new Error('OS store failed'); expect(new TextEncoder().encode(value).length).toBeLessThan(2048); state.values.set(key, value); },
  deleteItemAsync: async (key: string) => { state.values.delete(key); },
}));
import { secureAuthStorage } from './firebasePersistence';
beforeEach(() => { state.values.clear(); state.writes = 0; state.failAt = 0; });
it('round trips a large Firebase record using valid hashed keys and small secure-store chunks', async () => {
  const value = JSON.stringify({ token: '🔒'.repeat(5000) });
  await secureAuthStorage.setItem('firebase:authUser:public-key:[backend]', value);
  expect(await secureAuthStorage.getItem('firebase:authUser:public-key:[backend]')).toBe(value);
  expect([...state.values.keys()].every(key => /^[a-zA-Z0-9_.-]+$/.test(key))).toBe(true);
  await secureAuthStorage.removeItem('firebase:authUser:public-key:[backend]');
  expect(await secureAuthStorage.getItem('firebase:authUser:public-key:[backend]')).toBeNull();
  expect(state.values.size).toBe(0);
});
it('retains the last committed credentials if a chunk write fails', async () => {
  await secureAuthStorage.setItem('account', 'previous-token');
  state.failAt = state.writes + 2;
  await expect(secureAuthStorage.setItem('account', 'new-token'.repeat(1000))).rejects.toThrow('OS store failed');
  expect(await secureAuthStorage.getItem('account')).toBe('previous-token');
});
it('serializes concurrent writes so a reader never observes mixed generations', async () => {
  await Promise.all([secureAuthStorage.setItem('account', 'a'.repeat(3000)), secureAuthStorage.setItem('account', 'b'.repeat(3000))]);
  expect(await secureAuthStorage.getItem('account')).toBe('b'.repeat(3000));
});
