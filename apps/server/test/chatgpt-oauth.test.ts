/** @file Checks real JWT verification against a mocked OpenAI JWKS and confidential token exchange without contacting OpenAI. */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { openAIChatGptOAuth } from '../src/chatgpt-oauth';

afterEach(() => vi.unstubAllGlobals());
describe('OpenAI identity verification', () => {
  it('validates signature, issuer, audience, expiry and nonce with published keys', async () => {
    const pair = await generateKeyPair('RS256');
    const jwk = { ...await exportJWK(pair.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => String(input).endsWith('openid-configuration') ? Response.json({ issuer: 'https://auth.openai.com', authorization_endpoint: 'https://auth.openai.com/api/accounts/authorize', token_endpoint: 'https://auth.openai.com/api/accounts/oauth/token', jwks_uri: 'https://auth.openai.com/.well-known/jwks.json', revocation_endpoint: 'https://auth.openai.com/oauth/revoke' }) : Response.json({ keys: [jwk] })));
    const oauth = openAIChatGptOAuth({ clientId: 'oaiapp_test', redirectUri: 'https://say.example/api/chatgpt/callback' });
    const sign = (overrides: Record<string, unknown> = {}, key = pair.privateKey) => new SignJWT({ sub: 'parent', email: 'parent@example.com', nonce: 'expected-nonce', iss: 'https://auth.openai.com', aud: 'oaiapp_test', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, ...overrides }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(key);
    expect(await oauth.identity(await sign(), 'expected-nonce')).toEqual({ sub: 'parent', email: 'parent@example.com' });
    for (const overrides of [{ iss: 'https://attacker.example' }, { aud: 'another-client' }, { exp: 1 }, { nonce: 'wrong' }, { sub: '' }]) {
      await expect(oauth.identity(await sign(overrides), 'expected-nonce')).rejects.toThrow();
    }
    const other = await generateKeyPair('RS256');
    await expect(oauth.identity(await sign({}, other.privateKey), 'expected-nonce')).rejects.toThrow();
  });
  it('uses registered Basic client authentication and keeps secrets out of request bodies', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input); calls.push({ url, init });
      return url.endsWith('openid-configuration') ? Response.json({ issuer: 'https://auth.openai.com', authorization_endpoint: 'https://auth.openai.com/api/accounts/authorize', token_endpoint: 'https://auth.openai.com/api/accounts/oauth/token', jwks_uri: 'https://auth.openai.com/.well-known/jwks.json', revocation_endpoint: 'https://auth.openai.com/oauth/revoke' }) : Response.json({ id_token: 'identity' });
    }));
    const oauth = openAIChatGptOAuth({ clientId: 'oaiapp_test', clientSecret: 'client:secret', redirectUri: 'https://say.example/api/chatgpt/callback' });
    await oauth.exchange('one-time-code', 'pkce-verifier');
    const request = calls[1].init!;
    expect(request.headers).toMatchObject({ Authorization: `Basic ${Buffer.from('oaiapp_test:client%3Asecret').toString('base64')}` });
    const body = request.body as URLSearchParams;
    expect(body.get('code_verifier')).toBe('pkce-verifier');
    expect(body.get('redirect_uri')).toBe('https://say.example/api/chatgpt/callback');
    expect(body.get('resource')).toBe('https://api.openai.com/v1');
    expect(body.has('client_secret')).toBe(false);
  });
});
