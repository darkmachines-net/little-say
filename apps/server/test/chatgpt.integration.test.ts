/** @file Verifies ChatGPT OAuth binding, replay protection, encrypted durability, visitor isolation, renewal, and refusal to fall back to server billing. */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { testDatabase } from './postgres-fixture';
import { createServer } from '../src/app';
import { ChatGptConnections, chatGptConfig, type ChatGptConfig } from '../src/chatgpt';
import { ChatGptError, type ChatGptOAuth, type ChatGptTokens } from '../src/chatgpt-oauth';
import { type AiProvider } from '../src/provider';

const config: ChatGptConfig = { clientId: 'oaiapp_test', redirectUri: 'https://say.example/api/chatgpt/callback', encryptionKey: 'ab'.repeat(32), preferredModel: 'preferred-model' };
const tokens: ChatGptTokens = { access_token: 'visitor-access', refresh_token: 'visitor-refresh', id_token: 'signed-identity', token_type: 'Bearer', scope: 'openid chatgpt.tokens.use.direct', expires_in: 3600 };
const draft = { title: 'Farm', explanation: 'A cow.', needsClarification: false, tiles: [{ existingId: null, label: 'Cow', speech: 'Cow', language: 'en-US', emoji: '🐄', color: 'sage' as const }] };
const provider = (): AiProvider => ({ propose: vi.fn(async () => draft), transcribe: vi.fn(), translate: vi.fn(async () => ({ translations: [{ tileId: 'cow', language: 'es', label: 'Vaca', speech: 'Vaca' }] })) });
function adapter(): ChatGptOAuth {
  return { authorizationEndpoint: vi.fn(async () => 'https://auth.openai.com/api/accounts/authorize'), exchange: vi.fn(async () => ({ ...tokens })), identity: vi.fn(async () => ({ sub: 'visitor', email: 'visitor@example.com' })), refresh: vi.fn(async () => ({ ...tokens, access_token: 'renewed-access', refresh_token: 'renewed-refresh' })), revoke: vi.fn(async () => true), models: vi.fn(async () => [{ slug: 'available-model', display_name: 'Available model' }]) };
}
const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { vi.useRealTimers(); for (const close of cleanup.splice(0).reverse()) await close(); });
async function service(oauth = adapter(), factory = vi.fn(provider), overrides: Partial<ChatGptConfig> = {}) {
  const db = await testDatabase(); cleanup.push(() => db.close());
  const connections = new ChatGptConnections({ ...config, ...overrides }, db.pool, oauth, factory);
  return { connections, oauth, factory, pool: db.pool };
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
    const { connections, oauth } = await service();
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
    expect(await connections.status(id)).toMatchObject({ connected: true, planEnabled: true, welcome: true });
    expect(JSON.stringify(await connections.status(id))).not.toMatch(/visitor-access|visitor-refresh|signed-identity/);
    await expect(connections.complete(pending.binding, query)).rejects.toThrow();
    expect(oauth.exchange).toHaveBeenCalledOnce();
    await connections.acknowledge(id);
    expect((await connections.status(id)).welcome).toBe(false);
  });
  it('rejects expired, declined and mismatched-client callbacks without code exchange', async () => {
    const { connections, oauth } = await service();
    for (const result of [{ error: 'access_denied' }, { code: 'code', client_id: 'oaiapp_other' }]) {
      const pending = await connections.start('');
      await expect(connections.complete(pending.binding, { state: new URL(pending.url).searchParams.get('state')!, ...result })).rejects.toThrow();
    }
    const pending = await connections.start('');
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 600001);
    await expect(connections.complete(pending.binding, { state: new URL(pending.url).searchParams.get('state')!, code: 'expired' })).rejects.toThrow();
    expect(oauth.exchange).not.toHaveBeenCalled();
  });
  it('allows only one process to consume a callback transaction', async () => {
    const { connections, oauth, pool } = await service();
    const other = new ChatGptConnections(config, pool, oauth, vi.fn(provider));
    const pending = await connections.start('');
    const query = { state: new URL(pending.url).searchParams.get('state')!, code: 'single-use' };
    const results = await Promise.allSettled([connections.complete(pending.binding, query), other.complete(pending.binding, query)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(oauth.exchange).toHaveBeenCalledOnce();
  });
  it('keeps identity-only consent but refuses inference and requests explicit re-consent', async () => {
    const { connections, oauth, factory } = await service();
    vi.mocked(oauth.exchange).mockResolvedValue({ id_token: 'identity-only', scope: 'openid profile email' });
    const id = await connect(connections);
    expect(await connections.status(id)).toMatchObject({ connected: true, planEnabled: false });
    await expect(connections.provider(id)).rejects.toThrow('Allow ChatGPT plan usage');
    expect(factory).not.toHaveBeenCalled();
    expect(new URL((await connections.start(id)).url).searchParams.get('prompt')).toBe('consent');
  });
  it('refuses an unverified identity and prevents accidental account replacement', async () => {
    const { connections, oauth } = await service();
    vi.mocked(oauth.identity).mockRejectedValueOnce(new Error('invalid signature'));
    await expect(connect(connections)).rejects.toThrow('invalid signature');
    const id = await connect(connections);
    vi.mocked(oauth.identity).mockResolvedValueOnce({ sub: 'someone-else' });
    await expect(connect(connections, id)).rejects.toThrow('different ChatGPT account');
    expect((await connections.status(id)).email).toBe('visitor@example.com');
  });
  it('survives restart with encrypted credentials and a hashed browser session identifier', async () => {
    const { connections: first, pool } = await service();
    const id = await connect(first);
    const rows = JSON.stringify((await pool.query('SELECT * FROM chatgpt_sessions')).rows);
    for (const value of ['visitor-access', 'visitor-refresh', 'visitor@example.com', id]) expect(rows).not.toContain(value);
    const factory = vi.fn(provider);
    const connections = new ChatGptConnections(config, pool, adapter(), factory);
    await connections.provider(id);
    expect(factory).toHaveBeenCalledWith('visitor-access', 'available-model');
  });
  it('purges expired grants in bounded batches without deleting a live visitor', async () => {
    const { connections, pool } = await service();
    const id = await connect(connections);
    await pool.query("INSERT INTO chatgpt_sessions (id,value,expires) SELECT md5(n::text)||md5(n::text),s.value,$1 FROM chatgpt_sessions s CROSS JOIN generate_series(1,101) n", [Date.now() - 1]);
    await connections.start('');
    expect(Number((await pool.query('SELECT count(*) FROM chatgpt_sessions WHERE expires<=$1', [Date.now()])).rows[0].count)).toBe(1);
    expect((await connections.status(id)).connected).toBe(true);
    await connections.start('');
    expect(Number((await pool.query('SELECT count(*) FROM chatgpt_sessions')).rows[0].count)).toBe(1);
    expect((await connections.status(id)).connected).toBe(true);
  });
  it('serializes refreshes, uses the rotated token, and preserves a session after temporary failures', async () => {
    const { connections, oauth, factory } = await service();
    vi.mocked(oauth.exchange).mockResolvedValue({ ...tokens, expires_in: 1 });
    const id = await connect(connections);
    vi.mocked(oauth.refresh).mockRejectedValueOnce(new ChatGptError('temporary failure'));
    await expect(connections.provider(id)).rejects.toThrow('temporary');
    expect((await connections.status(id)).planEnabled).toBe(true);
    await Promise.all([connections.provider(id), connections.provider(id)]);
    expect(oauth.refresh).toHaveBeenCalledTimes(2);
    expect(factory).toHaveBeenCalledWith('renewed-access', 'available-model');
    expect(await connections.disconnect(id)).toEqual({ revoked: true });
    expect(oauth.revoke).toHaveBeenCalledWith('renewed-refresh');
    await expect(connections.provider(id)).rejects.toThrow('Reconnect');
  });
  it('clears unusable grants and reports unconfirmed remote revocation', async () => {
    const { connections, oauth } = await service();
    vi.mocked(oauth.exchange).mockResolvedValue({ ...tokens, expires_in: 1 });
    const id = await connect(connections);
    vi.mocked(oauth.refresh).mockRejectedValueOnce(new ChatGptError('Reconnect', 401, true));
    await expect(connections.provider(id)).rejects.toThrow('Reconnect');
    expect(await connections.status(id)).toMatchObject({ selected: true, needsLogin: true, planEnabled: false });
    const next = await connect(connections);
    vi.mocked(oauth.revoke).mockResolvedValue(false);
    expect(await connections.disconnect(next)).toEqual({ revoked: false });
    expect((await connections.status(next)).connected).toBe(false);
  });
  it('coordinates refresh and disconnect across separate service instances using the rotated grant', async () => {
    const { connections, oauth, pool } = await service();
    vi.mocked(oauth.exchange).mockResolvedValue({ ...tokens, expires_in: 1 });
    const id = await connect(connections);
    const other = new ChatGptConnections(config, pool, oauth, provider);
    let release!: () => void, started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    vi.mocked(oauth.refresh).mockImplementation(async () => { started(); await new Promise<void>(resolve => { release = resolve; }); return { ...tokens, access_token: 'rotated-access', refresh_token: 'rotated-refresh' }; });
    const refreshing = connections.provider(id).catch(() => undefined);
    await entered;
    const disconnecting = other.disconnect(id);
    release();
    await refreshing; await disconnecting;
    expect(oauth.refresh).toHaveBeenCalledOnce();
    expect(oauth.revoke).toHaveBeenCalledWith('rotated-refresh');
    expect((await connections.status(id)).connected).toBe(false);
    await expect(connections.provider(id)).rejects.toThrow('Reconnect');
  });
  it('does not resurrect a disconnected session from a pending reconnect', async () => {
    const { connections, oauth } = await service();
    const id = await connect(connections);
    const pending = await connections.start(id);
    await connections.disconnect(id);
    await expect(connections.complete(pending.binding, { state: new URL(pending.url).searchParams.get('state')!, code: 'late-code' })).rejects.toThrow('disconnected');
    expect(oauth.exchange).toHaveBeenCalledOnce();
    expect((await connections.status(id)).connected).toBe(false);
  });
});

describe('visitor billing API', () => {
  const headers = { 'x-little-say': '1', 'content-type': 'application/json', origin: 'https://say.example' };
  it('routes two visitors independently and never uses the server key on failures or unsupported capabilities', async () => {
    const oauth = adapter(), visitor = provider(), serverProvider = provider(), factory = vi.fn(() => visitor);
    const { connections } = await service(oauth, factory);
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
    const { connections } = await service(adapter(), vi.fn(provider));
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
