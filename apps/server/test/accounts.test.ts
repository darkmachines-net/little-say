/** @file Tests persistent authenticated backups, account isolation, complete-asset commits, recovery, and session revocation. */

import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts } from '../src/accounts';
import { createServer } from '../src/app';
import { starterLibrary } from '../../../tests/fixtures/library';

const servers: Awaited<ReturnType<typeof createServer>>[] = [];
const directories: string[] = [];
const password = 'a long test password';
const headers = { 'x-little-say': '1' };
afterEach(async () => { for (const server of servers.splice(0)) await server.close(); for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function server(path = ':memory:') {
  const app = await createServer({ provider: null, accounts: new Accounts(path), secureCookies: true }); servers.push(app); await app.ready(); return app;
}
async function register(app: Awaited<ReturnType<typeof server>>, username: string, native = true) {
  const response = await app.inject({ method: 'POST', url: '/api/account/register', headers, payload: { username, password, native } });
  expect(response.statusCode).toBe(200); return { ...response.json(), cookie: response.headers['set-cookie'] as string };
}
describe('optional private accounts', () => {
  it('leaves guest APIs available, requires authentication, and uses secure browser cookies without exposing a token', async () => {
    const app = await server();
    expect((await app.inject('/api/health')).statusCode).toBe(200);
    expect((await app.inject('/api/account/backup')).statusCode).toBe(401);
    const browser = await register(app, 'browser', false);
    expect(browser.token).toBeUndefined(); expect(browser.cookie).toContain('HttpOnly'); expect(browser.cookie).toContain('Secure'); expect(browser.cookie).toContain('SameSite=Strict');
    const cookie = browser.cookie.split(';')[0];
    expect((await app.inject({ url: '/api/account/backup', headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/account/backup', headers: { cookie, 'x-little-say-account': 'another-account' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/account/logout', headers: { ...headers, cookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/account/backup', headers: { cookie } })).statusCode).toBe(401);
  });
  it('saves complete boards and assets across a server restart, with revision checks and account isolation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'little-say-accounts-')); directories.push(directory);
    const path = join(directory, 'accounts.sqlite');
    let app = await server(path);
    const alice = await register(app, 'alice'), bob = await register(app, 'bob');
    const auth = { ...headers, authorization: `Bearer ${alice.token}` };
    const other = { ...headers, authorization: `Bearer ${bob.token}` };
    const bytes = Buffer.from('private photo fixture'); const hash = createHash('sha256').update(bytes).digest('hex');
    const board = starterLibrary().boards[0]; board.tiles[0].illustration = { kind: 'photo', assetId: 'family-photo', zoom: 2, x: 0.3, y: -0.2 };
    const snapshot = { revision: 0, boards: [board], assets: [{ kind: 'photo', id: 'family-photo', hash }] };
    expect((await app.inject({ method: 'POST', url: '/api/account/backup', headers: auth, payload: snapshot })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/api/account/assets/${hash}`, headers: auth, payload: { data: bytes.toString('base64') } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/account/backup', headers: auth, payload: snapshot })).json()).toEqual({ ...snapshot, revision: 1 });
    expect((await app.inject({ method: 'POST', url: '/api/account/backup', headers: auth, payload: snapshot })).statusCode).toBe(409);
    expect((await app.inject({ url: `/api/account/assets/${hash}`, headers: other })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/account/backup', headers: other, payload: snapshot })).statusCode).toBe(400);
    await app.close(); servers.splice(servers.indexOf(app), 1); app = await server(path);
    expect((await app.inject({ url: '/api/account/backup', headers: auth })).json()).toEqual({ ...snapshot, revision: 1 });
    expect((await app.inject({ url: `/api/account/assets/${hash}`, headers: auth })).json().data).toBe(bytes.toString('base64'));
    expect((await app.inject({ method: 'POST', url: '/api/account/backup', headers: auth, payload: { revision: 1, boards: [], assets: [] } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/account/backup', headers: auth })).json().boards).toEqual([]);
  });
  it('rejects incorrect passwords, rotates recovery codes, revokes old devices, and deletes private backups', async () => {
    const app = await server(); const account = await register(app, 'parent');
    const auth = { ...headers, authorization: `Bearer ${account.token}` };
    expect((await app.inject({ method: 'POST', url: '/api/account/login', headers, payload: { username: 'parent', password: 'the wrong password' } })).statusCode).toBe(401);
    const response = await app.inject({ method: 'POST', url: '/api/account/recover', headers, payload: { username: 'parent', password: 'the replacement password', recoveryCode: account.recoveryCode, native: true } });
    expect(response.statusCode).toBe(200); const recovered = response.json(); expect(recovered.recoveryCode).not.toBe(account.recoveryCode);
    expect((await app.inject({ url: '/api/account/backup', headers: auth })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/account/recover', headers, payload: { username: 'parent', password, recoveryCode: account.recoveryCode } })).statusCode).toBe(401);
    const nextAuth = { ...headers, authorization: `Bearer ${recovered.token}` };
    expect((await app.inject({ method: 'POST', url: '/api/account/delete', headers: nextAuth, payload: { password } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/account/delete', headers: nextAuth, payload: { password: 'the replacement password' } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/account/backup', headers: nextAuth })).statusCode).toBe(401);
  });
  it('rejects forged requests and corrupted assets without changing the backup', async () => {
    const app = await server(); const account = await register(app, 'parent');
    const auth = { ...headers, authorization: `Bearer ${account.token}` };
    expect((await app.inject({ method: 'POST', url: '/api/account/backup', headers: { ...auth, origin: 'https://evil.invalid' }, payload: { revision: 0, boards: [], assets: [] } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/account/assets/${'a'.repeat(64)}`, headers: auth, payload: { data: 'aGVsbG8=' } })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/account/backup', headers: auth })).json().revision).toBe(0);
  });
});
