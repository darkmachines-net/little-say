/** @file Coordinates opt-in authentication, debounced foreground sync, retry status, and local-only sign-out. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { mergeBoards, sessionSchema, type Library } from '@little-say/core';
import { type useLibrary } from '../data/useLibrary';
import { ApiError, apiFetch, backendUrl } from './api';
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
  const [recoveryCode, setRecoveryCode] = useState('');
  const current = useRef({ store, session, canSync, onRestored }); current.current = { store, session, canSync, onRestored };
  const operation = useRef<AbortController | null>(null);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void loadAccountSession().then(value => { if (mounted.current) setSession(value); }).catch(() => { if (mounted.current) setError('Saved sign-in could not be opened. Please sign in again.'); }).finally(() => { if (mounted.current) setReady(true); });
    return () => { mounted.current = false; operation.current?.abort(); };
  }, []);
  const sync = useCallback(async () => {
    const { store: libraryStore, session: account, canSync: allowed } = current.current;
    if (!account || running.current || !allowed || !libraryStore.current.current) return;
    if (Platform.OS === 'web' ? document.hidden : AppState.currentState !== 'active') return;
    if (backendUrl(libraryStore.current.current.settings.backendUrl) !== account.server) { setError('This account belongs to a different server. Restore its server address or sign out before using another account.'); return; }
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
    if (!ready || !session || needsLogin || !canSync || recoveryCode) return;
    const timer = setTimeout(() => void sync(), 1500);
    return () => clearTimeout(timer);
  }, [ready, session, needsLogin, canSync, signature, recoveryCode, sync]);
  useEffect(() => {
    if (!session || needsLogin || recoveryCode) return;
    const retry = () => { void sync(); };
    const timer = setInterval(retry, 30000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') retry(); });
    if (Platform.OS === 'web') window.addEventListener('online', retry);
    return () => { clearInterval(timer); subscription.remove(); if (Platform.OS === 'web') window.removeEventListener('online', retry); };
  }, [session, needsLogin, recoveryCode, sync]);
  const authenticate = async (mode: 'register' | 'login' | 'recover', username: string, password: string, code?: string) => {
    if (running.current) return;
    const server = backendUrl(store.current.current!.settings.backendUrl);
    setBusy(true); running.current = true; setError('');
    try {
      const result = sessionSchema.parse(await apiFetch(server, `/api/account/${mode}`, { credentials: 'include', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, native: Platform.OS !== 'web', ...(code ? { recoveryCode: code.trim() } : {}) }) }));
      const value = { account: result.account, server, token: result.token };
      await saveAccountSession(value); setSession(value); setNeedsLogin(false); setRecoveryCode(result.recoveryCode ?? '');
      setMessage(result.recoveryCode ? 'Save your recovery code before continuing.' : 'Signed in. Preparing to sync…');
    } catch (e) { setError((e as Error).message); throw e; }
    finally { running.current = false; setBusy(false); }
  };
  const disconnect = async (password?: string) => {
    if (running.current || !session) return;
    running.current = true; setBusy(true); setError('');
    try {
      if (password !== undefined) await accountRequest(session, '/delete', { password });
      else await accountRequest(session, '/logout', {}).catch(() => {});
      await saveAccountSession(null); setSession(null); setNeedsLogin(false); setRecoveryCode('');
      setMessage(password !== undefined ? 'Account and server backup deleted. Local boards remain on this device.' : 'Signed out. Local boards remain on this device.');
    } catch (e) { setError((e as Error).message); throw e; }
    finally { running.current = false; setBusy(false); }
  };
  const savedAt = store.library?.sync?.accountId === session?.account.id && store.library?.sync?.server === session?.server ? store.library?.sync?.savedAt : undefined;
  return { session, ready, busy, message, error, needsLogin, recoveryCode, savedAt, authenticate, disconnect, sync, acknowledgeRecovery: () => setRecoveryCode('') };
}
export type AccountController = ReturnType<typeof useAccount>;
