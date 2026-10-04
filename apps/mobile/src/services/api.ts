/** @file Provides backend address resolution and cancellable, validated JSON requests for AI features. */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { proposalSchema, translationEnvelopeSchema, type TranslationRequest, type BoardProposal, type ProposalRequest } from '@little-say/core';
import { resolveBackendUrl } from './backendConfig';

// Expo inlines this exact property access. It contains a URL, never a secret.
export const developmentApiUrl = typeof __DEV__ !== 'undefined' && __DEV__ ? process.env.EXPO_PUBLIC_API_URL || '' : '';

/** Resolve the development override, saved server, or platform default into the backend address. */
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
 * surface network and HTTP failures as errors.
 */
export async function apiFetch(configured: string, path: string, init: RequestInit = {}, externalSignal?: AbortSignal) {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 60000);
  const cancel = () => abort.abort();
  externalSignal?.addEventListener('abort', cancel, { once: true });
  if (externalSignal?.aborted) abort.abort();
  try {
    const response = await fetch(`${backendUrl(configured)}${path}`, { ...init, signal: abort.signal, headers: { 'X-Little-Say': '1', ...init.headers } });
    const data = await response.json().catch(() => { throw new Error('That server did not return a valid response. Check its address in Parent settings.'); });
    if (!response.ok) throw new ApiError(data.error || 'The server could not complete this request.', response.status);
    return data;
  } catch (error) {
    if (abort.signal.aborted) throw new Error(externalSignal?.aborted ? 'Request cancelled. Your board is unchanged.' : 'The server took too long. Your prompt is still here to try again.');
    if (error instanceof TypeError) throw new Error('Cannot reach your home server. Check Wi-Fi and the server address, or create a board manually.');
    throw error;
  } finally { clearTimeout(timeout); externalSignal?.removeEventListener('abort', cancel); }
}
/** Request and schema-check an AI board proposal without applying it to the saved library. */
export async function proposeBoard(url: string, request: ProposalRequest, signal?: AbortSignal): Promise<BoardProposal> {
  const response = await apiFetch(url, '/api/boards/propose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) }, signal);
  return proposalSchema.parse(response);
}
/**
 * Request and schema-check a translation envelope for the supplied board revision and missing
 * languages.
 */
export async function prepareTranslations(url: string, request: TranslationRequest, signal?: AbortSignal) {
  return translationEnvelopeSchema.parse(await apiFetch(url, '/api/boards/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) }, signal));
}
