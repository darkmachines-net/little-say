/** @file Verifies ChatGPT OAuth binding, replay protection, encrypted durability, visitor isolation, renewal, and refusal to fall back to server billing. */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../src/app';
import { ChatGptConnections, chatGptConfig, type ChatGptConfig } from '../src/chatgpt';
import { ChatGptError, type ChatGptOAuth, type ChatGptTokens } from '../src/chatgpt-oauth';
import { type AiProvider } from '../src/provider';

const config: ChatGptConfig = { clientId: 'oaiapp_test', redirectUri: 'https://say.example/api/chatgpt/callback', encryptionKey: 'ab'.repeat(32), database: ':memory:', preferredModel: 'preferred-model' };
const tokens: ChatGptTokens = { access_token: 'visitor-access', refresh_token: 'visitor-refresh', id_token: 'signed-identity', token_type: 'Bearer', scope: 'openid chatgpt.tokens.use.direct', expires_in: 3600 };
const draft = { title: 'Farm', explanation: 'A cow.', needsClarification: false, tiles: [{ existingId: null, label: 'Cow', speech: 'Cow', language: 'en-US', emoji: '🐄', color: 'sage' as const }] };
const provider = (): AiProvider => ({ propose: vi.fn(async () => draft), transcribe: vi.fn(), translate: vi.fn(async () => ({ translations: [{ tileId: 'cow', language: 'es', label: 'Vaca', speech: 'Vaca' }] })) });
function adapter(): ChatGptOAuth {
  return { authorizationEndpoint: vi.fn(async () => 'https://auth.openai.com/api/accounts/authorize'), exchange: vi.fn(async () => ({ ...tokens })), identity: vi.fn(async () => ({ sub: 'visitor', email: 'visitor@example.com' })), refresh: vi.fn(async () => ({ ...tokens, access_token: 'renewed-access', refresh_token: 'renewed-refresh' })), revoke: vi.fn(async () => true), models: vi.fn(async () => [{ slug: 'available-model', display_name: 'Available model' }]) };
}
const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { vi.useRealTimers(); for (const close of cleanup.splice(0).reverse()) await close(); });
function service(oauth = adapter(), factory = vi.fn(provider), overrides: Partial<ChatGptConfig> = {}) {
  const connections = new ChatGptConnections({ ...config, ...overrides }, oauth, factory);
  cleanup.push(() => connections.close());
  return { connections, oauth, factory };
}
async function connect(connections: ChatGptConnections, current = '') {
  const pending = await connections.start(current);
  const state = new URL(pending.url).searchParams.get('state')!;
  return connections.complete(pending.binding, { state, code: 'one-time-code' });
}

describe('ChatGPT sessions', () => {
  it('requires deliberate hosted configuration and a registered secure callback', () => {
    expect(chatGptConfig({})).toBeNull();
    expect(() => chatGptConfig({ CHATGPT_ENABLED: 'true' })).toThrow();
    const env = { CHATGPT_ENABLED: 'true', CHATGPT_CLIENT_ID: config.clientId, CHATGPT_ENCRYPTION_KEY: config.encryptionKey, CHATGPT_REDIRECT_URI: config.redirectUri, NODE_ENV: 'production' };
    expect(chatGptConfig(env)?.clientId).toBe(config.clientId);
    expect(() => chatGptConfig({ ...env, CHATGPT_REDIRECT_URI: 'http://127.0.0.1/api/chatgpt/callback' })).toThrow();
  });
  it('binds fresh state, PKCE and nonce to a one-use browser cookie', async () => {
    const { connections, oauth } = service();
    const pending = await connections.start('');
    const params = new URL(pending.url).searchParams;
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('resource')).toBe('https://api.openai.com/v1');
    expect(params.get('scope')).toContain('chatgpt.tokens.use.direct');
    const query = { code: 'code', state: params.get('state')! };
    await expect(connections.complete('wrong-browser', query)).rejects.toThrow();
    await expect(connections.complete(pending.binding, { ...query, state: 'wrong-state' })).rejects.toThrow();
    expect(oauth.exchange).not.toHaveBeenCalled();
    const id = await connections.complete(pending.binding, query);
    expect(oauth.identity).toHaveBeenCalledWith('signed-identity', params.get('nonce'));
    expect(connections.status(id)).toMatchObject({ connected: true, planEnabled: true, welcome: true });
    expect(JSON.stringify(connections.status(id))).not.toMatch(/visitor-access|visitor-refresh|signed-identity/);
    await expect(connections.complete(pending.binding, query)).rejects.toThrow();
    expect(oauth.exchange).toHaveBeenCalledOnce();
    connections.acknowledge(id);
    expect(connections.status(id).welcome).toBe(false);
  });
  it('rejects expired, declined and mismatched-client callbacks without code exchange', async () => {
    const { connections, oauth } = service();
    for (const result of [{ error: 'access_denied' }, { code: 'code', client_id: 'oaiapp_other' }]) {
      const pending = await connections.start('');
      await expect(connections.complete(pending.binding, { state: new URL(pending.url).searchParams.get('state')!, ...result })).rejects.toThrow();
    }
    const pending = await connections.start('');
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 600001);
    await expect(connections.complete(pending.binding, { state: new URL(pending.url).searchParams.get('state')!, code: 'expired' })).rejects.toThrow();
    expect(oauth.exchange).not.toHaveBeenCalled();
  });
  it('keeps identity-only consent but refuses inference and requests explicit re-consent', async () => {
    const { connections, oauth, factory } = service();
    vi.mocked(oauth.exchange).mockResolvedValue({ id_token: 'identity-only', scope: 'openid profile email' });
    const id = await connect(connections);
    expect(connections.status(id)).toMatchObject({ connected: true, planEnabled: false });
    await expect(connections.provider(id)).rejects.toThrow('Allow ChatGPT plan usage');
    expect(factory).not.toHaveBeenCalled();
    expect(new URL((await connections.start(id)).url).searchParams.get('prompt')).toBe('consent');
  });
  it('refuses an unverified identity and prevents accidental account replacement', async () => {
    const { connections, oauth } = service();
    vi.mocked(oauth.identity).mockRejectedValueOnce(new Error('invalid signature'));
    await expect(connect(connections)).rejects.toThrow('invalid signature');
    const id = await connect(connections);
    vi.mocked(oauth.identity).mockResolvedValueOnce({ sub: 'someone-else' });
    await expect(connect(connections, id)).rejects.toThrow('different ChatGPT account');
    expect(connections.status(id).email).toBe('visitor@example.com');
  });
  it('survives restart with encrypted credentials and a hashed browser session identifier', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'little-say-chatgpt-')), 'sessions.sqlite');
    const first = new ChatGptConnections({ ...config, database: path }, adapter(), provider);
    const id = await connect(first); first.close();
    const bytes = readFileSync(path).toString();
    for (const value of ['visitor-access', 'visitor-refresh', 'visitor@example.com', id]) expect(bytes).not.toContain(value);
    const { connections, factory } = service(adapter(), vi.fn(provider), { database: path });
    await connections.provider(id);
    expect(factory).toHaveBeenCalledWith('visitor-access', 'available-model');
  });
  it('serializes refreshes, uses the rotated token, and preserves a session after temporary failures', async () => {
    const { connections, oauth, factory } = service();
    vi.mocked(oauth.exchange).mockResolvedValue({ ...tokens, expires_in: 1 });
    const id = await connect(connections);
    vi.mocked(oauth.refresh).mockRejectedValueOnce(new ChatGptError('temporary failure'));
    await expect(connections.provider(id)).rejects.toThrow('temporary');
    expect(connections.status(id).planEnabled).toBe(true);
    await Promise.all([connections.provider(id), connections.provider(id)]);
    expect(oauth.refresh).toHaveBeenCalledTimes(2);
    expect(factory).toHaveBeenCalledWith('renewed-access', 'available-model');
    expect(await connections.disconnect(id)).toEqual({ revoked: true });
    expect(oauth.revoke).toHaveBeenCalledWith('renewed-refresh');
    await expect(connections.provider(id)).rejects.toThrow('Reconnect');
  });
  it('clears unusable grants and reports unconfirmed remote revocation', async () => {
    const { connections, oauth } = service();
    vi.mocked(oauth.exchange).mockResolvedValue({ ...tokens, expires_in: 1 });
    const id = await connect(connections);
    vi.mocked(oauth.refresh).mockRejectedValueOnce(new ChatGptError('Reconnect', 401, true));
    await expect(connections.provider(id)).rejects.toThrow('Reconnect');
    expect(connections.status(id)).toMatchObject({ selected: true, needsLogin: true, planEnabled: false });
    const next = await connect(connections);
    vi.mocked(oauth.revoke).mockResolvedValue(false);
    expect(await connections.disconnect(next)).toEqual({ revoked: false });
    expect(connections.status(next).connected).toBe(false);
  });
  it('does not resurrect a disconnected session from a pending reconnect', async () => {
    const { connections, oauth } = service();
    const id = await connect(connections);
    const pending = await connections.start(id);
    await connections.disconnect(id);
    await expect(connections.complete(pending.binding, { state: new URL(pending.url).searchParams.get('state')!, code: 'late-code' })).rejects.toThrow('disconnected');
    expect(oauth.exchange).toHaveBeenCalledOnce();
    expect(connections.status(id).connected).toBe(false);
  });
});

describe('visitor billing API', () => {
  const headers = { 'x-little-say': '1', 'content-type': 'application/json', origin: 'https://say.example' };
  it('routes two visitors independently and never uses the server key on failures or unsupported capabilities', async () => {
    const oauth = adapter(), visitor = provider(), serverProvider = provider(), factory = vi.fn(() => visitor);
    const connections = new ChatGptConnections(config, oauth, factory);
    const app = await createServer({ provider: serverProvider, chatgpt: connections, origins: ['https://say.example'] });
    cleanup.push(() => app.close());
    const first = await connect(connections);
    vi.mocked(oauth.exchange).mockResolvedValue({ ...tokens, access_token: 'second-visitor' });
    const second = await connect(connections);
    const payload = { prompt: 'A cow', board: null };
    for (const [id, token] of [[first, 'visitor-access'], [second, 'second-visitor']]) {
      expect((await app.inject({ method: 'POST', url: '/api/boards/propose', headers: { ...headers, cookie: `little_say_chatgpt=${id}` }, payload })).statusCode).toBe(200);
      expect(factory).toHaveBeenLastCalledWith(token, 'available-model');
    }
    const selected = { ...headers, cookie: `little_say_chatgpt=${first}` };
    const translations = await app.inject({ method: 'POST', url: '/api/boards/translate', headers: selected, payload: { boardId: 'farm', baseRevision: 0, tiles: [{ id: 'cow', label: 'Cow', speech: 'Cow', language: 'en', targets: ['es'] }] } });
    expect(translations.statusCode).toBe(200);
    vi.mocked(visitor.propose).mockRejectedValue(new ChatGptError('ChatGPT usage limit reached.', 429));
    expect((await app.inject({ method: 'POST', url: '/api/boards/propose', headers: selected, payload })).statusCode).toBe(429);
    for (const url of ['/api/speech', '/api/transcribe', '/api/pictures/analyze', '/api/pictures/jobs', '/api/pictures/review']) {
      expect((await app.inject({ method: 'POST', url, headers: selected, payload: {} })).statusCode).toBe(409);
    }
    await connections.disconnect(first);
    expect((await app.inject({ method: 'POST', url: '/api/boards/propose', headers: selected, payload })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/boards/propose', headers: { ...headers, 'x-little-say-ai': 'chatgpt' }, payload })).statusCode).toBe(401);
    expect(serverProvider.propose).not.toHaveBeenCalled();
    expect((await app.inject({ method: 'POST', url: '/api/boards/propose', headers, payload })).statusCode).toBe(200);
    expect(serverProvider.propose).toHaveBeenCalledOnce();
  });
  it('sets HttpOnly cookies, clears callback state, and redirects without credentials', async () => {
    const connections = new ChatGptConnections(config, adapter(), provider);
    const app = await createServer({ provider: null, chatgpt: connections, origins: ['https://say.example'] }); cleanup.push(() => app.close());
    const start = await app.inject({ method: 'POST', url: '/api/chatgpt/connect', headers, payload: {} });
    expect(start.statusCode).toBe(200);
    expect(start.headers['set-cookie']).toMatch(/HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
    const state = new URL(start.json().url).searchParams.get('state');
    const callback = await app.inject({ url: `/api/chatgpt/callback?state=${state}&code=one-time`, headers: { cookie: String(start.headers['set-cookie']).split(';')[0] } });
    expect(callback.headers.location).toBe('/app?chatgpt=connected');
    expect(callback.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(callback.headers)).not.toContain('visitor-access');
    expect(callback.headers['set-cookie']).toHaveLength(2);
    expect((await app.inject({ url: `/api/chatgpt/callback?state=${state}&code=one-time` })).headers.location).toBe('/app?chatgpt=error');
  });
  it('keeps the option unavailable until configured and rejects a remembered selection', async () => {
    const api = provider(); const app = await createServer({ provider: api, origins: ['https://say.example'] }); cleanup.push(() => app.close());
    expect((await app.inject('/api/chatgpt/status')).json().available).toBe(false);
    expect((await app.inject({ method: 'POST', url: '/api/chatgpt/connect', headers, payload: {} })).statusCode).toBe(503);
    expect((await app.inject({ method: 'POST', url: '/api/boards/propose', headers: { ...headers, 'x-little-say-ai': 'chatgpt' }, payload: { prompt: 'A cow', board: null } })).statusCode).toBe(401);
    expect(api.propose).not.toHaveBeenCalled();
  });
});
