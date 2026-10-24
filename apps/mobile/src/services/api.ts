/** @file Provides backend address resolution and cancellable, validated JSON requests for AI features. */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { proposalSchema, translationEnvelopeSchema, type TranslationRequest, type BoardProposal, type ProposalRequest } from '@little-say/core';
import { resolveBackendUrl } from './backendConfig';

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
 * Request backend JSON with the app header, a 60-second timeout, and optional external cancellation;
 * surface network and HTTP failures as errors. Account requests pin the exact consented server
 * to prevent credentials following a development override or changed backend.
 */
export async function apiFetch(configured: string, path: string, init: RequestInit = {}, externalSignal?: AbortSignal, exactServer = false) {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 60000);
  const cancel = () => abort.abort();
  externalSignal?.addEventListener('abort', cancel, { once: true });
  if (externalSignal?.aborted) abort.abort();
  try {
    const server = exactServer ? configured : backendUrl(configured);
    const response = await fetch(`${server}${path}`, { ...init, signal: abort.signal, headers: { 'X-Little-Say': '1', ...init.headers } });
    const data = await response.json().catch(() => { throw new Error('Little Say’s service returned an unexpected response. Please try again.'); });
    if (!response.ok) throw new ApiError(data.error || 'The server could not complete this request.', response.status);
    return data;
  } catch (error) {
    if (abort.signal.aborted) throw new Error(externalSignal?.aborted ? 'Request cancelled. Your board is unchanged.' : 'The server took too long. Your prompt is still here to try again.', { cause: error });
    if (error instanceof TypeError) throw new Error('Cannot reach Little Say. Check your connection and try again, or create a board manually.', { cause: error });
    throw error;
  } finally { clearTimeout(timeout); externalSignal?.removeEventListener('abort', cancel); }
}
/** Negotiate picture support, then schema-check an AI proposal without applying it to the saved library. */
export async function proposeBoard(url: string, request: ProposalRequest, signal?: AbortSignal): Promise<BoardProposal> {
  let input = request;
  if (request.pictureCapability) {
    const health = await apiFetch(url, '/api/health', {}, signal);
    if (health.pictures?.version !== 1) { const { pictureCapability: _capability, picturePolicy: _policy, ...legacy } = request; input = legacy; }
  }
  const response = await apiFetch(url, '/api/boards/propose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }, signal);
  return proposalSchema.parse(response);
}
/**
 * Request and schema-check a translation envelope for the supplied board revision and missing
 * languages.
 */
export async function prepareTranslations(url: string, request: TranslationRequest, signal?: AbortSignal) {
  return translationEnvelopeSchema.parse(await apiFetch(url, '/api/boards/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) }, signal));
}
