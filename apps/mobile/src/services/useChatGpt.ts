/** @file Reads browser ChatGPT connection state and controls explicit sign-in, welcome acknowledgement, and billing disconnection. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { z } from 'zod';
import { apiFetch, backendUrl } from './api';
import { prefersChatGpt, rememberChatGpt } from './aiBilling';

const statusSchema = z.object({ available: z.boolean(), selected: z.boolean(), connected: z.boolean(), planEnabled: z.boolean(), needsLogin: z.boolean(), welcome: z.boolean(), email: z.string().optional(), model: z.string().optional() });

/** Maintain origin-bound display state; native clients and cross-origin web backends cannot start this browser-only OAuth flow. */
export function useChatGpt(configured: string) {
  const server = backendUrl(configured);
  const supported = Platform.OS === 'web' && server === window.location.origin;
  const refreshSequence = useRef(0);
  const [status, setStatus] = useState<z.infer<typeof statusSchema> | null>(null);
  const [loading, setLoading] = useState(supported);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!supported) return;
    const sequence = ++refreshSequence.current;
    try {
      const next = statusSchema.parse(await apiFetch(server, '/api/chatgpt/status', {}, signal, true));
      if (signal?.aborted || sequence !== refreshSequence.current) return;
      if (next.selected) rememberChatGpt(server, true);
      if (!next.selected && prefersChatGpt(server)) { next.selected = true; next.needsLogin = true; }
      if (!signal?.aborted) { setStatus(next); setError(''); }
    } catch (error) { if (!signal?.aborted && sequence === refreshSequence.current) setError((error as Error).message); }
    finally { if (!signal?.aborted && sequence === refreshSequence.current) setLoading(false); }
  }, [server, supported]);
  useEffect(() => {
    setStatus(null); setLoading(supported);
    const controller = new AbortController();
    void refresh(controller.signal);
    const focus = () => { void refresh(controller.signal); };
    if (supported) { window.addEventListener('focus', focus); window.addEventListener('storage', focus); }
    return () => { controller.abort(); if (supported) { window.removeEventListener('focus', focus); window.removeEventListener('storage', focus); } };
  }, [refresh, supported]);
  const action = async (work: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('');
    try { await work(); } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  };
  return { status, supported, loading, busy, error, message, selected: status?.selected || (supported && prefersChatGpt(server)),
    /** Leave this page for the server-created OpenAI authorization URL. */
    connect: () => action(async () => {
      if (!supported) throw new Error('Open the Little Say website to connect ChatGPT.');
      const result = await apiFetch(server, '/api/chatgpt/connect', { method: 'POST' }, undefined, true);
      const url = new URL(result.url);
      if (url.origin !== 'https://auth.openai.com') throw new Error('ChatGPT sign-in address could not be verified.');
      window.location.assign(url.href);
    }),
    /** Explicitly switch to server billing after deleting this browser's ChatGPT session. */
    disconnect: () => action(async () => {
      ++refreshSequence.current;
      const result = await apiFetch(server, '/api/chatgpt/disconnect', { method: 'POST' }, undefined, true);
      rememberChatGpt(server, false); await refresh();
      setMessage(result.revoked ? 'ChatGPT disconnected. AI requests now use the server’s API key.' : 'Disconnected here. Remote revocation was not confirmed; remove Little Say in ChatGPT settings. AI requests now use the server’s API key.');
    }),
    /** Persist first-connection acknowledgement without changing provider selection. */
    acknowledge: () => action(async () => { await apiFetch(server, '/api/chatgpt/acknowledge', { method: 'POST' }, undefined, true); await refresh(); }),
  };
}
