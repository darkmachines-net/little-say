/** @file Resolves the backend and authenticates cancellable JSON requests, including polling durable AI operations. */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { proposalSchema, translationEnvelopeSchema, type TranslationRequest, type BoardProposal, type ProposalRequest } from '@little-say/core';
import { resolveBackendUrl } from './backendConfig';
import { applicationHeaders } from './requestAuth';

// Expo inlines these exact property accesses. Remote web uses Metro's same-origin proxy; native goes directly.
export const developmentApiUrl = typeof __DEV__ !== 'undefined' && __DEV__
  ? (Platform.OS === 'web' && process.env.EXPO_PUBLIC_WEB_API_URL ? window.location.origin : process.env.EXPO_PUBLIC_API_URL || '')
  : '';

/** Resolve the build's service address, retaining same-origin web hosting and development overrides. */
export function backendUrl(configured: string) {
  const fallback = Platform.OS === 'web' ? window.location.origin : Constants.expoConfig?.extra?.serverUrl;
  return resolveBackendUrl(configured, developmentApiUrl, fallback);
}
export class ApiError extends Error {
  /** Preserve the server HTTP status alongside its error message for caller-specific handling. */
  constructor(message: string, readonly status: number) { super(message); }
}

/**
 * Request backend JSON with a 60-second HTTP timeout and independently polled asynchronous AI results;
 * surface network and HTTP failures as errors. Account requests pin the exact consented server
 * to prevent credentials following a development override or changed backend.
 */
export async function apiFetch(configured: string, path: string, init: RequestInit = {}, externalSignal?: AbortSignal, exactServer = false) {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 60000);
  const server = exactServer ? configured : backendUrl(configured);
  let accepted: string | undefined;
  const cancel = () => abort.abort();
  externalSignal?.addEventListener('abort', cancel, { once: true });
  if (externalSignal?.aborted) abort.abort();
  try {
    const protectedRequest = !path.startsWith('/api/account/') && !['/api/health', '/api/ready'].includes(path) && !path.startsWith('/api/pictures/search') && !path.startsWith('/api/pictures/library/');
    const authentication = protectedRequest ? await applicationHeaders(server, init.method === 'POST') : {};
    const response = await fetch(`${server}${path}`, { ...init, redirect: 'error', credentials: 'include', signal: abort.signal, headers: { 'X-Little-Say': '1', ...(init.method === 'POST' ? { 'X-Little-Say-Request': Crypto.randomUUID() } : {}), ...authentication, ...init.headers } });
    const data = await response.json().catch(() => { throw new Error('Little Say’s service returned an unexpected response. Please try again.'); });
    if (!response.ok) throw new ApiError(data.error || 'The server could not complete this request.', response.status);
    if (response.status === 202 && typeof data.kind === 'string' && typeof data.id === 'string') {
      clearTimeout(timeout); accepted = data.id;
      const deadline = Date.now() + 30 * 60 * 1000;
      let job = data;
      while (true) {
        abort.signal.throwIfAborted();
        if (['cancelled', 'error', 'interrupted'].includes(job.state)) throw new ApiError(job.error || 'AI work stopped. Your saved board is unchanged.', 409);
        if (job.result !== null && job.result !== undefined) return job.result;
        if (Date.now() > deadline) throw new Error('AI work took too long. Your saved board is unchanged.');
        await new Promise<void>((done, reject) => {
          const stop = () => { clearTimeout(timer); abort.signal.removeEventListener('abort', stop); reject(new Error('Cancelled')); };
          const timer = setTimeout(() => { abort.signal.removeEventListener('abort', stop); done(); }, 500);
          abort.signal.addEventListener('abort', stop, { once: true }); if (abort.signal.aborted) stop();
        });
        job = await apiFetch(server, `/api/ai/jobs/${accepted}`, {}, abort.signal, true);
      }
    }
    return data;
  } catch (error) {
    if (accepted) void apiFetch(server, `/api/ai/jobs/${accepted}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, undefined, true).catch(() => {});
    if (abort.signal.aborted) throw new Error(externalSignal?.aborted ? 'Request cancelled. Your board is unchanged.' : 'The server took too long. Your prompt is still here to try again.', { cause: error });
    if (error instanceof TypeError) throw new Error('Cannot reach Little Say. Check your connection and try again, or create a board manually.', { cause: error });
    throw error;
  } finally { clearTimeout(timeout); externalSignal?.removeEventListener('abort', cancel); }
}
/**
 * Negotiate picture support, then schema-check a proposal without applying it to the saved library.
 * Health preparation.version=1 permits a caller-generated UUID preparationId alongside pictures.version=1;
 * aborting also cancels that batch before a proposal returns. Capability discovery is cached per backend
 * session. Older peers retain the original picture/proposal protocol.
 */
export async function proposeBoard(url: string, request: ProposalRequest, signal?: AbortSignal): Promise<BoardProposal> {
  let input = request;
  if (request.pictureCapability) {
    const health = await serverCapabilities(url, signal);
    if (signal?.aborted) throw new Error('Request cancelled.');
    if (health.pictures?.version !== 1) { const { pictureCapability: _capability, picturePolicy: _policy, preparationId: _id, previousPreparationId: _previous, ...legacy } = request; input = legacy; }
    else if (health.preparation?.version === 1) input = { ...request, preparationId: request.preparationId ?? Crypto.randomUUID() };
  }
  const cancel = () => { if (input.preparationId) void apiFetch(url, `/api/pictures/batches/${input.preparationId}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const response = await apiFetch(url, '/api/boards/propose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }, signal);
    if (signal?.aborted) { cancel(); throw new Error('Request cancelled.'); }
    return proposalSchema.parse(response);
  } catch (error) { cancel(); throw error; }
  finally { signal?.removeEventListener('abort', cancel); }
}

type Capabilities = { pictures?: { version?: number }; preparation?: { version?: number } };
const capabilities = new Map<string, Capabilities>();
/** Cache successful capability discovery per backend session; failed or cancelled reads remain retryable. */
async function serverCapabilities(url: string, signal?: AbortSignal): Promise<Capabilities> {
  const key = backendUrl(url); const known = capabilities.get(key); if (known) return known;
  const result = await apiFetch(url, '/api/health', {}, signal) as Capabilities;
  if (!signal?.aborted) capabilities.set(key, result);
  return result;
}
/**
 * Request and schema-check a translation envelope for the supplied board revision and missing
 * languages.
 */
export async function prepareTranslations(url: string, request: TranslationRequest, signal?: AbortSignal) {
  return translationEnvelopeSchema.parse(await apiFetch(url, '/api/boards/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) }, signal));
}
