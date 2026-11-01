/** @file Coordinates persisted sign-in, Home restoration, and automatic backup with independent sync and account-action feedback. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { mergeBoards, type Library, type AuthConfig } from '@little-say/core';
import { type useLibrary } from '../data/useLibrary';
import { ApiError, backendUrl } from './api';
import { accountContext, authenticateAccount, resetAccountPassword, signOutAccount, accountDeletionProof, verifyAccountEmail, linkAccountProvider, accountError, socialAuthAvailable, type Provider } from './firebaseAccount';
import { accountRequest, syncAccount } from './accountSync';
import { loadAccountSession, saveAccountSession, type AccountSession } from './accountSession';
import { accountBackupState, backupConnectionFailure } from './accountBackup';

/** Restore sign-in, keep empty devices on Home during restoration, and expose backup status separately from authentication feedback. */
export function useAccount(store: ReturnType<typeof useLibrary>, canSync: boolean, onRestored: () => Promise<void>) {
  const [session, setSession] = useState<AccountSession | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncFailure, setSyncFailure] = useState<{ message: string; offline: boolean } | null>(null);
  const [online, setOnline] = useState(() => Platform.OS !== 'web' || navigator.onLine !== false);
  const current = useRef({ store, session, canSync, onRestored, online }); current.current = { store, session, canSync, onRestored, online };
  const operation = useRef<AbortController | null>(null);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void loadAccountSession().then(value => {
      if (!mounted.current) return;
      setSession(value);
      if (value && value.server !== backendUrl(current.current.store.current.current?.settings.backendUrl ?? '')) {
        setNeedsLogin(true); setMessage('Little Say’s server changed. Sign in again to resume automatic backup. Your local boards are safe.');
      }
    }).catch(() => { if (mounted.current) setError('Saved sign-in could not be opened. Please sign in again.'); }).finally(() => { if (mounted.current) setReady(true); });
    return () => { mounted.current = false; operation.current?.abort(); };
  }, []);
  const sync = useCallback(async () => {
    const { store: libraryStore, session: account, canSync: allowed } = current.current;
    const local = libraryStore.current.current;
    // Empty devices show restoration on Home, including direct editor links, until cloud content is known.
    const initialRestore = Boolean(account && local && !local.boards.length && (local.sync?.accountId !== account.account.id || local.sync.server !== account.server));
    if (!account || account.account.deletionPending || !account.account.emailVerified || running.current || (!allowed && !initialRestore) || !local || !current.current.online) return;
    if (Platform.OS === 'web' ? document.hidden : AppState.currentState !== 'active') return;
    if (backendUrl(local.settings.backendUrl) !== account.server) { setNeedsLogin(true); setMessage('This account belongs to a different server. Sign in again. Your local boards are safe.'); return; }
    running.current = true; setBusy(true); setSyncing(true); setSyncFailure(null);
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
      while (!current.current.canSync && !initialRestore && !controller.signal.aborted) await new Promise(resolve => setTimeout(resolve, 250));
      if (controller.signal.aborted) return;
      await libraryStore.mergeSync((local: Library) => {
        const boards = mergeBoards(start.boards, local.boards, snapshot.boards, () => Crypto.randomUUID());
        return { ...local, boards, ...(boards.length ? { setup: undefined } : {}),
          sync: { accountId: account.account.id, server: account.server, snapshot, savedAt: new Date().toISOString() },
          settings: { ...local.settings, activeBoardId: boards.some(board => board.id === local.settings.activeBoardId) ? local.settings.activeBoardId : null } };
      });
      await current.current.onRestored();
      setNeedsLogin(false);
    } catch (e) {
      if (!controller.signal.aborted && mounted.current) {
        const expired = e instanceof ApiError && e.status === 401;
        if (expired) { setNeedsLogin(true); setMessage('Your session has expired. Sign in again to resume sync.'); }
        else setSyncFailure({ message: e instanceof Error ? e.message : 'Backup could not complete.', offline: backupConnectionFailure(e) });
      }
    } finally { running.current = false; operation.current = null; if (mounted.current) { setBusy(false); setSyncing(false); } }
  }, []);
  const signature = JSON.stringify(store.library?.boards);
  const savedAt = store.library?.sync?.accountId === session?.account.id && store.library?.sync?.server === session?.server ? store.library?.sync?.savedAt : undefined;
  const restoring = Boolean(session?.account.emailVerified && !session.account.deletionPending && !needsLogin && store.library && !store.library.boards.length && !savedAt);
  const pending = !savedAt || signature !== JSON.stringify(store.library?.sync?.snapshot.boards);
  const backup = {
    state: accountBackupState({ needsLogin: !session || needsLogin, deletionPending: Boolean(session?.account.deletionPending), verified: Boolean(session?.account.emailVerified),
      offline: !online || Boolean(syncFailure?.offline), error: Boolean(syncFailure), restoring, syncing, pending }),
    savedAt, pending, error: syncFailure?.message ?? '',
    conflicts: Boolean(savedAt && store.library?.boards.some(board => board.title.endsWith('(conflict copy)'))),
  };
  useEffect(() => {
    if (!ready || !session || needsLogin || (!canSync && !restoring)) return;
    const timer = setTimeout(() => void sync(), 1500);
    return () => clearTimeout(timer);
  }, [ready, session, needsLogin, canSync, restoring, signature, sync]);
  useEffect(() => {
    if (!session || needsLogin) return;
    const retry = () => { void sync(); };
    const timer = setInterval(retry, 30000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') retry(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [session, needsLogin, sync]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const connected = () => { current.current.online = true; setOnline(true); void sync(); };
    const disconnected = () => { current.current.online = false; setOnline(false); };
    window.addEventListener('online', connected); window.addEventListener('offline', disconnected);
    return () => { window.removeEventListener('online', connected); window.removeEventListener('offline', disconnected); };
  }, [sync]);
  const run = async (action: () => Promise<void>) => {
    if (running.current) {
      const message = 'Another account operation is finishing. Please try again in a moment.';
      setError(message); throw new Error(message);
    }
    running.current = true; setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (e) { setError(accountError(e)); throw e; }
    finally { running.current = false; setBusy(false); }
  };
  const remember = async (value: AccountSession) => {
    await saveAccountSession(value); current.current.session = value; setSession(value); setNeedsLogin(false); setSyncFailure(null);
  };
  const prepare = async () => {
    // Provider choices can be retried after a connection failure without losing the login form.
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
    setMessage(resend ? 'Verification email sent. Open the link, then check verification here.' : 'Email verification checked.');
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
    await saveAccountSession(null); current.current.session = null; setSession(null); setNeedsLogin(false); setSyncFailure(null);
    setMessage(deleting ? 'Account deletion requested. This server will finish removing the shared login and its backup. Local boards remain here.' : 'Signed out. Local boards remain on this device.');
  });
  /** Clear page-specific authentication feedback without changing backup status or an in-flight operation. */
  const clearFeedback = useCallback(() => { setError(''); setMessage(''); }, []);
  return { session, ready, busy, syncing, backup, message, error, clearFeedback, needsLogin, savedAt, restoring, retrySync: sync, config: config ?? session?.authConfig, prepare, authenticate, resetPassword, verifyEmail, link, disconnect, socialAvailable: socialAuthAvailable() };
}
export type AccountController = ReturnType<typeof useAccount>;
