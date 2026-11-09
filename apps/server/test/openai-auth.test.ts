/** @file Verifies Google metadata exchange, concurrent token reuse, expiration, and local key compatibility. */

import { afterEach, expect, it, vi } from 'vitest';
import { openAICredential } from '../src/openai-auth';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('uses local key priority and refuses to fall back from partial federation settings', () => {
  expect(openAICredential({ AAC_OPENAI_KEY: ' app-key ', OPENAI_API_KEY: 'fallback' })).toBe('app-key');
  expect(openAICredential({ OPENAI_API_KEY: ' fallback ' })).toBe('fallback');
  expect(openAICredential({ OPENAI_API_KEY: '  ' })).toBeUndefined();
  expect(openAICredential({ OPENAI_IDENTITY_PROVIDER_ID: 'idp-test', OPENAI_API_KEY: 'legacy' })).toBeUndefined();
  expect(openAICredential({ OPENAI_SERVICE_ACCOUNT_ID: 'sa-test', OPENAI_API_KEY: 'legacy' })).toBeUndefined();
});

it('lazily exchanges the worker identity once for concurrent callers and renews expired tokens', async () => {
  let exchanges = 0;
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  const transport = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === 'metadata.google.internal') {
      expect(url.pathname).toBe('/computeMetadata/v1/instance/service-accounts/default/identity');
      expect(url.searchParams.get('audience')).toBe('https://api.openai.com/v1');
      expect(new Headers(options?.headers).get('Metadata-Flavor')).toBe('Google');
      return new Response('google-identity-token');
    }
    expect(url.href).toBe('https://auth.openai.com/oauth/token');
    expect(options).toMatchObject({ method: 'POST', redirect: 'manual', signal: expect.any(AbortSignal) });
    expect(JSON.parse(String(options?.body))).toEqual({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
      subject_token: 'google-identity-token',
      identity_provider_id: 'idp-test',
      service_account_id: 'sa-test',
    });
    return Response.json({ access_token: `openai-token-${++exchanges}`, expires_in: 120 });
  });
  vi.stubGlobal('fetch', transport);
  const env = { OPENAI_IDENTITY_PROVIDER_ID: ' idp-test ', OPENAI_SERVICE_ACCOUNT_ID: ' sa-test ' };
  const token = openAICredential(env);
  if (typeof token !== 'function') throw new Error('Expected a federated credential.');
  expect(openAICredential(env)).toBe(token);
  expect(transport).not.toHaveBeenCalled();
  expect(await Promise.all([token(), token()])).toEqual(['openai-token-1', 'openai-token-1']);
  expect(await token()).toBe('openai-token-1');
  expect(transport).toHaveBeenCalledTimes(2);
  clock.mockReturnValue(now + 121000);
  expect(await token()).toBe('openai-token-2');
  expect(transport).toHaveBeenCalledTimes(4);
});
