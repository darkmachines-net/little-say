/** @file Coordinates optional account sign-in, explicit device backup consent, and foreground synchronization. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { mergeBoards, type Library, type AuthConfig } from '@little-say/core';
import { type useLibrary } from '../data/useLibrary';
import { ApiError, backendUrl } from './api';
import { accountContext, authenticateAccount, resetAccountPassword, signOutAccount, accountDeletionProof, verifyAccountEmail, linkAccountProvider, accountError, socialAuthAvailable, type Provider } from './firebaseAccount';
import { accountRequest, syncAccount } from './accountSync';
import { loadAccountSession, saveAccountSession, type AccountSession } from './accountSession';

/** Keep account access optional and server-bound; never block local editing on connectivity or authentication. */
export function useAccount(store: ReturnType<typeof useLibrary>, canSync: boolean, onRestored: () => Promise<void>) {
  const [session, setSession] = useState<AccountSession | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const current = useRef({ store, session, canSync, onRestored }); current.current = { store, session, canSync, onRestored };
  const operation = useRef<AbortController | null>(null);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void loadAccountSession().then(value => {
      if (!mounted.current) return;
      setSession(value);
      if (value && value.server !== backendUrl(current.current.store.current.current?.settings.backendUrl ?? '')) {
        setNeedsLogin(true); setMessage('Little Say’s server changed. Sign in again and choose whether to enable backup. Your local boards are safe.');
      }
    }).catch(() => { if (mounted.current) setError('Saved sign-in could not be opened. Please sign in again.'); }).finally(() => { if (mounted.current) setReady(true); });
    return () => { mounted.current = false; operation.current?.abort(); };
  }, []);
  const sync = useCallback(async () => {
    const { store: libraryStore, session: account, canSync: allowed } = current.current;
    if (!account?.backupEnabled || account.account.deletionPending || !account.account.emailVerified || running.current || !allowed || !libraryStore.current.current) return;
    if (Platform.OS === 'web' ? document.hidden : AppState.currentState !== 'active') return;
    if (backendUrl(libraryStore.current.current.settings.backendUrl) !== account.server) { setError('This account belongs to a different server. Sign out and sign in again to use this version of Little Say. Your local boards are safe.'); return; }
    running.current = true; setBusy(true); setError(''); setMessage('Syncing boards and assets…');
    const controller = new AbortController(); operation.current = controller;
    try {
      await libraryStore.flush();
      const start = libraryStore.current.current!;
      let snapshot;
      for (let attempt = 0; ; attempt++) {
        try { snapshot = await syncAccount(start, account, controller.signal); break; }
        catch (e) { if (!(e instanceof ApiError) || e.status !== 409 || attempt === 2) throw e; }
      }
      if (controller.signal.aborted || !mounted.current) return;
      // A parent may enter play or an editor while files are downloading. Apply the completed
      // snapshot when they return, preserving any edits made since the request began.
      while (!current.current.canSync && !controller.signal.aborted) await new Promise(resolve => setTimeout(resolve, 250));
      if (controller.signal.aborted) return;
      await libraryStore.mergeSync((local: Library) => {
        const boards = mergeBoards(start.boards, local.boards, snapshot.boards, () => Crypto.randomUUID());
        return { ...local, boards, ...(boards.length ? { setup: undefined } : {}),
          sync: { accountId: account.account.id, server: account.server, snapshot, savedAt: new Date().toISOString() },
          settings: { ...local.settings, activeBoardId: boards.some(board => board.id === local.settings.activeBoardId) ? local.settings.activeBoardId : null } };
      });
      await current.current.onRestored();
      const newerEdits = JSON.stringify(libraryStore.current.current?.boards) !== JSON.stringify(snapshot.boards);
      setMessage(newerEdits ? 'Backup saved. Your newer edits are waiting for the next sync.' : snapshot.boards.some(board => board.title.endsWith('(conflict copy)')) ? 'Synced. Conflicting edits were kept as separate boards marked “conflict copy”.' : 'All boards and assets are synced.'); setNeedsLogin(false);
    } catch (e) {
      if (!controller.signal.aborted && mounted.current) {
        setError(e instanceof ApiError && e.status === 401 ? 'Your session has expired. Sign in again to resume sync.' : (e as Error).message);
        setMessage('Changes stay on this device until sync succeeds.');
        if (e instanceof ApiError && e.status === 401) setNeedsLogin(true);
      }
    } finally { running.current = false; operation.current = null; if (mounted.current) setBusy(false); }
  }, []);
  const signature = JSON.stringify(store.library?.boards);
  useEffect(() => {
    if (!ready || !session || needsLogin || !canSync) return;
    const timer = setTimeout(() => void sync(), 1500);
    return () => clearTimeout(timer);
  }, [ready, session, needsLogin, canSync, signature, sync]);
  useEffect(() => {
    if (!session || needsLogin) return;
    const retry = () => { void sync(); };
    const timer = setInterval(retry, 30000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') retry(); });
    if (Platform.OS === 'web') window.addEventListener('online', retry);
    return () => { clearInterval(timer); subscription.remove(); if (Platform.OS === 'web') window.removeEventListener('online', retry); };
  }, [session, needsLogin, sync]);
  const run = async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true; setBusy(true); setError('');
    try { await action(); } catch (e) { setError(accountError(e)); throw e; }
    finally { running.current = false; setBusy(false); }
  };
  const remember = async (value: AccountSession) => {
    const previous = current.current.session;
    value = { ...value, backupEnabled: previous?.server === value.server && previous.account.id === value.account.id && previous.backupEnabled === true };
    await saveAccountSession(value); current.current.session = value; setSession(value); setNeedsLogin(false);
    setMessage(value.account.deletionPending ? 'Deletion is pending. Retry Delete account to finish Apple confirmation.' : value.account.emailVerified ? 'Signed in. You can enable backup for this device.' : 'Verify your email to enable backup. AI and local boards are already available.');
  };
  const setBackupEnabled = async (enabled: boolean) => run(async () => {
    const value = current.current.session;
    if (!value || value.server !== backendUrl(store.current.current!.settings.backendUrl)) throw new Error('Sign in to this server before enabling backup.');
    const updated = { ...value, backupEnabled: enabled };
    await saveAccountSession(updated); current.current.session = updated; setSession(updated);
    setMessage(enabled ? 'Backup enabled for this device.' : 'Backup paused. Saved server copies remain until you delete your account.');
  });
  const prepare = async () => {
    // Loading public provider choices must never trap a guest on an unavailable server.
    const server = backendUrl(store.current.current!.settings.backendUrl);
    setError(''); setConfig(null);
    try {
      const context = await accountContext(server);
      if (mounted.current && backendUrl(store.current.current!.settings.backendUrl) === server) setConfig(context.config);
    } catch (e) {
      if (mounted.current && backendUrl(store.current.current!.settings.backendUrl) === server) setError(accountError(e));
      throw e;
    }
  };
  const authenticate = async (mode: 'register' | 'login', email: string, password: string, provider: Provider = 'password') => run(async () => {
    const server = backendUrl(store.current.current!.settings.backendUrl);
    await remember(await authenticateAccount(server, mode, email, password, provider));
  });
  const resetPassword = async (email: string) => run(async () => {
    await resetAccountPassword(backendUrl(store.current.current!.settings.backendUrl), email);
    setMessage('If this email has a password account, a reset email has been sent.');
  });
  const verifyEmail = async (password: string, resend: boolean, provider: Provider = 'password') => run(async () => {
    if (!session) return;
    await remember(await verifyAccountEmail(session, password, resend, provider));
    if (resend) setMessage('Verification email sent. Open the link, then check verification here.');
  });
  const link = async (target: Provider, email: string, newPassword: string, provider: Provider, password: string) => run(async () => {
    if (!session) return;
    await remember(await linkAccountProvider(session, target, email, newPassword, provider, password));
    setMessage('Sign-in method linked to this account.');
  });
  const disconnect = async (deleting = false, password = '', provider: Provider = 'password') => run(async () => {
    if (!session) return;
    if (deleting) await accountRequest(session, '/delete', await accountDeletionProof(session, provider, password));
    else await accountRequest(session, '/logout', {}).catch(() => {});
    await signOutAccount(session);
    await saveAccountSession(null); current.current.session = null; setSession(null); setNeedsLogin(false);
    setMessage(deleting ? 'Account deletion requested. This server will finish removing the shared login and its backup. Local boards remain here.' : 'Signed out. Local boards remain on this device.');
  });
  const savedAt = store.library?.sync?.accountId === session?.account.id && store.library?.sync?.server === session?.server ? store.library?.sync?.savedAt : undefined;
  return { session, ready, busy, message, error, needsLogin, savedAt, config: config ?? session?.authConfig, prepare, authenticate, resetPassword, verifyEmail, link, disconnect, sync, setBackupEnabled, socialAvailable: socialAuthAvailable() };
}
export type AccountController = ReturnType<typeof useAccount>;
