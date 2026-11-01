/** @file Verifies automatic backup states, raced edits, isolated action feedback, restoration gates, retry, and safe lifecycle boundaries. */
import React, { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { starterLibrary } from '../../../../tests/fixtures/library';
import type { Library } from '@little-say/core';
import type { AccountSession } from './accountSession';
import { useAccount, type AccountController } from './useAccount';

const state = vi.hoisted(() => ({ server: 'https://example.test', foreground: 'active' }));
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), authenticate: vi.fn(), verify: vi.fn(), sync: vi.fn(), request: vi.fn(), restored: vi.fn() }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' }, AppState: {
  /** Expose foreground state to the scheduler under test. */
  get currentState() { return state.foreground; }, addEventListener: vi.fn(() => ({ remove: vi.fn() })),
} }));
vi.mock('expo-crypto', () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock('./api', () => ({ backendUrl: () => state.server, ApiError: class extends Error {
  /** Preserve HTTP status for automatic retry versus reauthentication. */
  constructor(message: string, readonly status: number) { super(message); }
} }));
vi.mock('./accountSession', () => ({ loadAccountSession: mocks.load, saveAccountSession: mocks.save }));
vi.mock('./accountSync', () => ({ syncAccount: mocks.sync, accountRequest: mocks.request }));
vi.mock('./firebaseAccount', () => ({ authenticateAccount: mocks.authenticate, verifyAccountEmail: mocks.verify, socialAuthAvailable: () => false,
  accountError: (error: Error) => error.message, signOutAccount: vi.fn(), accountContext: vi.fn(), resetAccountPassword: vi.fn(), accountDeletionProof: vi.fn(), linkAccountProvider: vi.fn(),
}));
const session: AccountSession = {
  account: { id: '00000000-0000-4000-8000-000000000001', email: 'parent@example.test', displayName: 'Parent', emailVerified: true, providers: ['password'] },
  server: 'https://example.test', firebaseUid: 'parent',
  authConfig: { projectId: 'test-project', apiKey: 'public-key', appId: 'public-app', authDomain: 'example.test', providers: ['password'] },
};
let screen: ReactTestRenderer | undefined, controller: AccountController, allowed = true;
let library: Library;
const store = { library: undefined as Library | undefined, current: { current: undefined as Library | undefined }, flush: vi.fn(),
  mergeSync: vi.fn(async (merge: (library: Library) => Library) => { library = merge(library); store.library = store.current.current = library; }),
};
function Harness() { controller = useAccount(store as unknown as Parameters<typeof useAccount>[0], allowed, mocks.restored); return null; }
async function mount(saved: AccountSession | null = session) {
  mocks.load.mockResolvedValue(saved);
  await act(async () => { screen = create(React.createElement(Harness)); });
}
async function advance(ms = 1500) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.server = session.server; state.foreground = 'active'; allowed = true;
  library = starterLibrary(); store.library = store.current.current = library;
  mocks.sync.mockResolvedValue({ revision: 0, boards: library.boards, assets: [] });
  mocks.authenticate.mockResolvedValue(session); mocks.verify.mockResolvedValue(session); mocks.request.mockResolvedValue({});
});
afterEach(async () => { if (screen) await act(async () => screen!.unmount()); screen = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

it('automatically backs up a restored account even if old metadata had backup paused', async () => {
  await mount({ ...session, backupEnabled: false } as AccountSession); await advance();
  expect(mocks.sync).toHaveBeenCalledOnce(); expect(mocks.restored).toHaveBeenCalledOnce();
  expect(library.sync?.accountId).toBe(session.account.id);
});

it('starts backup after sign-in without a separate action and stops after sign-out', async () => {
  await mount(null); await advance(); expect(mocks.sync).not.toHaveBeenCalled();
  await act(async () => controller.authenticate('login', 'parent@example.test', 'password'));
  expect(mocks.save).toHaveBeenCalledWith(session);
  await advance(); expect(mocks.sync).toHaveBeenCalledOnce();
  await act(async () => controller.disconnect());
  await advance(30000); expect(mocks.sync).toHaveBeenCalledOnce(); expect(mocks.save).toHaveBeenLastCalledWith(null);
});

it('waits for verification then backs up automatically', async () => {
  await mount({ ...session, account: { ...session.account, emailVerified: false } });
  await advance(30000); expect(mocks.sync).not.toHaveBeenCalled();
  await act(async () => controller.verifyEmail('password', false));
  await advance(); expect(mocks.sync).toHaveBeenCalledOnce();
});

it('defers sync during play or editing and resumes when it is safe', async () => {
  allowed = false; await mount(); await advance(30000); expect(mocks.sync).not.toHaveBeenCalled();
  allowed = true; await act(async () => screen!.update(React.createElement(Harness)));
  await advance(); expect(mocks.sync).toHaveBeenCalledOnce();
});

it('keeps local edits after a network failure and retries automatically', async () => {
  mocks.sync.mockRejectedValueOnce(new Error('Offline'));
  await mount(); await advance(); expect(controller.backup.error).toBe('Offline'); expect(controller.backup.state).toBe('error'); expect(library.sync).toBeUndefined();
  await advance(30000); expect(mocks.sync).toHaveBeenCalledTimes(2); expect(library.sync?.accountId).toBe(session.account.id);
});

it('reports transport loss separately and clears it only after another sync starts', async () => {
  mocks.sync.mockRejectedValueOnce(new Error('Cannot reach service', { cause: new TypeError('Network request failed') }));
  await mount(); await advance(); expect(controller.backup.state).toBe('offline');
  await act(async () => controller.clearFeedback()); expect(controller.backup.state).toBe('offline');
  await advance(30000); expect(controller.backup.state).toBe('synced');
});

it('keeps newer edits pending when they arrive during an in-flight backup', async () => {
  let finish!: (snapshot: { revision: number; boards: Library['boards']; assets: [] }) => void;
  const original = library.boards;
  mocks.sync.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await mount(); expect(controller.backup.state).toBe('pending');
  await advance(); expect(controller.syncing).toBe(true); expect(controller.backup.state).toBe('syncing');
  library = { ...library, boards: library.boards.map(board => ({ ...board, title: 'Newer edit', revision: board.revision + 1 })) };
  store.library = store.current.current = library;
  await act(async () => { screen!.update(React.createElement(Harness)); finish({ revision: 1, boards: original, assets: [] }); });
  expect(controller.backup.state).toBe('pending'); expect(controller.savedAt).toBeDefined();
  expect(library.boards[0].title).toBe('Newer edit');
});

it('preserves an authentication error when automatic backup succeeds', async () => {
  await mount(); await advance();
  mocks.verify.mockRejectedValueOnce(new Error('Wrong password'));
  await act(async () => { await controller.verifyEmail('wrong', false).catch(() => {}); });
  expect(controller.error).toBe('Wrong password');
  await advance(30000);
  expect(controller.backup.state).toBe('synced'); expect(controller.error).toBe('Wrong password');
});

it('keeps an empty device in restoration after failure until a successful cloud retry', async () => {
  allowed = false; // An unauthenticated direct editor link must not prevent first-device restoration.
  library = { ...library, boards: [] }; store.library = store.current.current = library;
  mocks.sync.mockRejectedValueOnce(new Error('Offline'));
  await mount(); expect(controller.restoring).toBe(true);
  await advance(); expect(controller.restoring).toBe(true);
  await act(async () => controller.retrySync());
  expect(controller.restoring).toBe(false); expect(library.boards.length).toBeGreaterThan(0);
});

it('does not sync an account belonging to another server or pending deletion', async () => {
  await mount({ ...session, server: 'https://old.example.test' }); await advance(30000);
  expect(controller.needsLogin).toBe(true); expect(mocks.sync).not.toHaveBeenCalled();
  await act(async () => screen!.unmount());
  await mount({ ...session, account: { ...session.account, deletionPending: true } }); await advance(30000);
  expect(mocks.sync).not.toHaveBeenCalled();
});
