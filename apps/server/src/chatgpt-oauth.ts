/** @file Implements OpenAI OIDC discovery, PKCE token exchange, identity validation, renewal, and revocation for approved hosted clients. */

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';

export const chatGptScope = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
export const chatGptResource = 'https://api.openai.com/v1';
const issuer = 'https://auth.openai.com';
const tokenSchema = z.object({
  access_token: z.string().optional(), refresh_token: z.string().optional(), id_token: z.string().optional(),
  token_type: z.string().optional(), expires_in: z.number().positive().optional(), scope: z.string().optional(),
});
export type ChatGptTokens = z.infer<typeof tokenSchema>;
export type ChatGptIdentity = { sub: string; email?: string };
export interface ChatGptOAuth {
  /** Return the discovered authorization endpoint; no credentials are included. */
  authorizationEndpoint(): Promise<string>;
  /** Exchange a one-time code with its original verifier and registered redirect URI. */
  exchange(code: string, verifier: string): Promise<ChatGptTokens>;
  /** Verify signature, issuer, audience, expiration, and nonce before returning identity. */
  identity(idToken: string, nonce: string): Promise<ChatGptIdentity>;
  /** Renew a token set; the caller must serialize refresh and save rotated credentials. */
  refresh(refreshToken: string): Promise<ChatGptTokens>;
  /** Revoke a renewable session, returning false when remote revocation is unconfirmed. */
  revoke(refreshToken: string): Promise<boolean>;
  /** Fetch the signed-in account's visible model catalog using its access token. */
  models(accessToken: string): Promise<{ slug: string; display_name: string }[]>;
}

/** Carries a safe explanation and a terminal-credential flag without exposing provider response bodies. */
export class ChatGptError extends Error {
  /** Preserve the response status and whether saved tokens must be cleared. */
  constructor(message: string, readonly statusCode = 502, readonly terminal = false) { super(message); }
}

/** Translate provider admission or terminal-stream failures into actionable messages, without billing fallback. */
export function chatGptRequestError(error: unknown): ChatGptError {
  if (error instanceof ChatGptError) return error;
  const detail = (error ?? {}) as { code?: string; status?: number };
  if (detail.code === 'subscription_sharing_usage_limit_exceeded' || detail.status === 429) return new ChatGptError('ChatGPT usage limit reached. Open Manage usage to review your plan or app limit.', 429);
  if (detail.code === 'subscription_sharing_user_not_eligible') return new ChatGptError('This ChatGPT account or workspace is not eligible for plan usage.', 403);
  if (detail.status === 401 || detail.code === 'subscription_sharing_invalid_user') return new ChatGptError('Reconnect ChatGPT in Settings to continue.', 401, true);
  if (detail.status === 403) return new ChatGptError('ChatGPT did not authorize this request. Check the account and this app’s access in ChatGPT settings.', 403);
  return new ChatGptError('ChatGPT could not complete the request. Try again later. The server API key was not used.', 502);
}

/** Create the network adapter for an explicitly approved hosted client; tokens never enter browser JavaScript. */
export function openAIChatGptOAuth(config: { clientId: string; clientSecret?: string; redirectUri: string }): ChatGptOAuth {
  let discovery: Promise<{ authorization_endpoint: string; token_endpoint: string; jwks_uri: string; revocation_endpoint: string }> | undefined;
  let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
  const metadata = () => discovery ??= (async () => {
    const response = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new ChatGptError('ChatGPT sign-in is temporarily unavailable.');
    const data = z.object({ issuer: z.literal(issuer), authorization_endpoint: z.url(), token_endpoint: z.url(), jwks_uri: z.url(), revocation_endpoint: z.url() }).parse(await response.json());
    for (const endpoint of [data.authorization_endpoint, data.token_endpoint, data.jwks_uri, data.revocation_endpoint]) {
      if (new URL(endpoint).origin !== issuer) throw new ChatGptError('The ChatGPT identity configuration could not be verified.');
    }
    return data;
  })().catch(error => { discovery = undefined; throw error; });
  const headers = () => {
    const result: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
    if (config.clientSecret) {
      const form = (value: string) => new URLSearchParams({ value }).toString().slice(6);
      result.Authorization = `Basic ${Buffer.from(`${form(config.clientId)}:${form(config.clientSecret)}`).toString('base64')}`;
    }
    return result;
  };
  const token = async (params: Record<string, string>) => {
    const response = await fetch((await metadata()).token_endpoint, { method: 'POST', headers: headers(), body: new URLSearchParams({ client_id: config.clientId, resource: chatGptResource, ...params }), signal: AbortSignal.timeout(15000) });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      const terminal = ['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused'].includes(String(data.error));
      throw new ChatGptError(terminal ? 'Reconnect ChatGPT in Settings to continue.' : 'ChatGPT sign-in could not be completed. Try again later.', terminal ? 401 : 502, terminal);
    }
    return tokenSchema.parse(data);
  };
  return {
    async authorizationEndpoint() { return (await metadata()).authorization_endpoint; },
    async exchange(code, verifier) { return token({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: config.redirectUri }); },
    async refresh(refreshToken) { return token({ grant_type: 'refresh_token', refresh_token: refreshToken }); },
    async identity(idToken, nonce) {
      jwks ??= createRemoteJWKSet(new URL((await metadata()).jwks_uri));
      const { payload } = await jwtVerify(idToken, jwks, { issuer, audience: config.clientId, requiredClaims: ['sub', 'exp', 'iat'], clockTolerance: 5 });
      if (payload.nonce !== nonce || typeof payload.sub !== 'string' || !payload.sub) throw new ChatGptError('ChatGPT sign-in could not be verified.', 401);
      return { sub: payload.sub, ...(typeof payload.email === 'string' ? { email: payload.email } : {}) };
    },
    async revoke(refreshToken) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await fetch((await metadata()).revocation_endpoint, { method: 'POST', headers: headers(), body: new URLSearchParams({ client_id: config.clientId, token: refreshToken, token_type_hint: 'refresh_token' }), signal: AbortSignal.timeout(5000) });
          if (response.ok) return true;
          if (response.status < 500) return false;
        } catch { /* A bounded second attempt may recover a transient network failure. */ }
        if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 250));
      }
      return false;
    },
    async models(accessToken) {
      const response = await fetch(`${chatGptResource}/models`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw chatGptRequestError({ status: response.status });
      const data = z.object({ models: z.array(z.object({ slug: z.string().min(1), display_name: z.string(), visibility: z.string() })) }).parse(await response.json());
      return data.models.filter(model => model.visibility === 'list');
    },
  };
}
