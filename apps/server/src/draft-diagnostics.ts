/** @file Classifies drafting failures without retaining prompts, model output, error messages, headers, or account data. */

import OpenAI from 'openai';
import { ZodError } from 'zod';

export type DraftFailure = { category: 'cancelled' | 'timeout' | 'connection' | 'provider-http' | 'invalid-json' | 'schema' | 'incomplete' | 'refusal' | 'storage' | 'unknown'; status?: number; providerRequestId?: string; issueCount?: number };
export type DraftMetric = { operation: string; milliseconds: number; inputTokens?: number; outputTokens?: number; requestId?: string; outcome: 'success' | 'failure'; stage?: string; failure?: DraftFailure };

/** Marks a terminal provider response that cannot supply a usable draft; contains no response content. */
export class DraftResponseError extends Error {
  /** Record only the bounded reason, never the model's refusal or partial output. */
  constructor(readonly category: 'incomplete' | 'refusal') { super('No complete board response.'); }
}

/** Accept only UUID correlation IDs, including when a caller supplies an invalid request directly. */
export function draftRequestId(value?: string): string | undefined {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : undefined;
}

/** Return a bounded classification suitable for logs; never serialize the original error or its cause. */
export function draftFailure(error: unknown, cancelled = false): DraftFailure {
  if (cancelled || error instanceof OpenAI.APIUserAbortError) return { category: 'cancelled' };
  if (error instanceof OpenAI.APIConnectionTimeoutError) return { category: 'timeout' };
  if (error instanceof OpenAI.APIConnectionError) return { category: 'connection' };
  if (error instanceof OpenAI.APIError) return { category: 'provider-http', ...(error.status ? { status: error.status } : {}),
    ...(error.requestID && /^req_[a-zA-Z0-9_-]{1,128}$/.test(error.requestID) ? { providerRequestId: error.requestID } : {}) };
  if (error instanceof SyntaxError) return { category: 'invalid-json' };
  if (error instanceof ZodError) return { category: 'schema', issueCount: error.issues.length };
  if (error instanceof DraftResponseError) return { category: error.category };
  if (error instanceof Error && 'code' in error && ['EACCES', 'EPERM', 'ENOSPC', 'ENOENT', 'EIO'].includes(String(error.code))) return { category: 'storage' };
  return { category: 'unknown' };
}
