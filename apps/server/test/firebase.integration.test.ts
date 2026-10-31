/** @file Verifies registered Firebase-emulator sessions and guest rejection, local test-account provisioning, CSRF, revocation, backups, and deletion. */
import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FirebaseIdentity, firebaseConfig } from '../src/accounts/firebase';
import { Accounts } from '../src/accounts/store';
import { createServer } from '../src/app';
import { testDatabase } from './postgres-fixture';
import { initializeApp as clientApp, deleteApp as deleteClientApp } from 'firebase/app';
import { initializeAuth, inMemoryPersistence, connectAuthEmulator, signInWithEmailAndPassword, signInWithCredential, GoogleAuthProvider, linkWithCredential } from 'firebase/auth';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
const project = 'demo-little-say';
const headers = { 'x-little-say': '1' };
async function setup(environment = 'test') {
  if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')) throw new Error('Start the local Auth emulator and set FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099.');
  const db = await testDatabase(); cleanup.push(() => db.close());
  const adminApp = initializeApp({ projectId: project }, randomUUID()), admin = getAuth(adminApp); cleanup.push(() => deleteApp(adminApp));
  const auth = new FirebaseIdentity({ ...process.env, NODE_ENV: environment, FIREBASE_PROJECT_ID: project, FIREBASE_API_KEY: 'demo-key', FIREBASE_APP_ID: 'demo-app', FIREBASE_AUTH_PROVIDERS: 'password' });
  const accounts = new Accounts(db.pool), app = await createServer({ provider: null, accounts, auth, secureCookies: true });
  cleanup.push(() => app.close());
  const email = randomUUID() + '@example.test', password = 'a long test passphrase';
  const registered = await rest('accounts:signUp', { email, password, returnSecureToken: true });
  const uid = registered.localId as string;
  cleanup.push(() => admin.deleteUser(uid).catch(() => {}));
  return { app, auth, admin, accounts, uid, email, password, token: registered.idToken as string };
}
async function rest(method: string, body: unknown) {
  const response = await fetch('http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST + '/identitytoolkit.googleapis.com/v1/' + method + '?key=demo-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error?.message || 'Emulator request failed'); return value;
}
async function native(fixture: Awaited<ReturnType<typeof setup>>) {
  return fixture.app.inject({ method: 'POST', url: '/api/account/session', headers, payload: { idToken: fixture.token, native: true } });
}
async function browser(fixture: Awaited<ReturnType<typeof setup>>) {
  const csrf = await fixture.app.inject('/api/account/csrf'), csrfCookie = String(csrf.headers['set-cookie']).split(';')[0];
  const login = await fixture.app.inject({ method: 'POST', url: '/api/account/session', headers: { ...headers, cookie: csrfCookie, 'x-little-say-csrf': csrf.json().csrfToken }, payload: { idToken: fixture.token } });
  expect(login.statusCode).toBe(200);
  return { login, headers: { ...headers, cookie: String(login.headers['set-cookie']).split(';')[0] + '; ' + csrfCookie, 'x-little-say-csrf': csrf.json().csrfToken } };
}

it('keeps health available and gates backup on verified email with no password endpoint', async () => {
  const f = await setup(); expect((await f.app.inject('/api/health')).statusCode).toBe(200);
  expect((await f.app.inject('/api/account/backup')).statusCode).toBe(401);
  expect((await native(f)).statusCode).toBe(200);
  const access = { ...headers, authorization: 'Bearer ' + f.token };
  expect((await f.app.inject({ url: '/api/account/backup', headers: access })).statusCode).toBe(403);
  await f.admin.updateUser(f.uid, { emailVerified: true });
  expect((await f.app.inject({ url: '/api/account/backup', headers: access })).statusCode).toBe(200);
  expect((await f.app.inject({ method: 'POST', url: '/api/account/register', headers, payload: {} })).statusCode).toBe(404);
});
it('rejects anonymous tokens and legacy guest cookies before granting app access', async () => {
  const f = await setup();
  const guest = await rest('accounts:signUp', { returnSecureToken: true });
  cleanup.push(() => f.admin.deleteUser(guest.localId));
  await expect(f.auth.verify(guest.idToken)).rejects.toMatchObject({ statusCode: 401 });
  expect((await native({ ...f, token: guest.idToken })).statusCode).toBe(401);
  const identity = { project, uid: guest.localId, email: null, displayName: null, emailVerified: false, providers: [], authTime: Math.floor(Date.now() / 1000), expires: Math.floor(Date.now() / 1000) + 3600 };
  // Model a persisted guest cookie created by an older app release.
  const owner = await f.accounts.provision(identity);
  const cookie = await f.accounts.issueCookie(owner, await f.auth.cookie(guest.idToken), identity.expires);
  for (const access of [{ authorization: 'Bearer ' + guest.idToken }, { cookie: '__session=' + cookie }]) {
    expect((await f.app.inject({ url: '/api/account/session', headers: access })).statusCode).toBe(401);
    expect((await f.app.inject({ url: '/api/account/backup', headers: access })).statusCode).toBe(401);
  }
});
it('protects cookie exchange and mutation with CSRF, uses secure cookies, and invalidates only logout cookie', async () => {
  const f = await setup(); await f.admin.updateUser(f.uid, { emailVerified: true });
  expect((await f.app.inject({ method: 'POST', url: '/api/account/session', headers, payload: { idToken: f.token } })).statusCode).toBe(403);
  const first = await browser(f);
  const second = await browser(f);
  expect(first.login.headers['set-cookie']).toMatch(/HttpOnly; SameSite=Strict; Max-Age=1209600; Secure/);
  expect(first.login.json().token).toBeUndefined();
  expect((await f.app.inject({ url: '/api/account/backup', headers: first.headers })).statusCode).toBe(200);
  expect((await f.app.inject({ method: 'POST', url: '/api/account/logout', headers: { ...headers, cookie: first.headers.cookie }, payload: {} })).statusCode).toBe(403);
  expect((await f.app.inject({ method: 'POST', url: '/api/account/logout', headers: first.headers, payload: {} })).statusCode).toBe(200);
  expect((await f.app.inject({ url: '/api/account/backup', headers: first.headers })).statusCode).toBe(401);
  expect((await f.app.inject({ url: '/api/account/backup', headers: second.headers })).statusCode).toBe(200);
  expect((await f.app.inject({ url: '/api/account/backup', headers: { ...headers, authorization: 'Bearer ' + f.token } })).statusCode).toBe(200);
});
it('rejects wrong audience, expired tokens, disabled identities and cross-tab expected-account changes', async () => {
  const f = await setup(); const session = await native(f);
  const parts = f.token.split('.'), claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  for (const altered of [{ ...claims, aud: 'another-project' }, { ...claims, exp: 1 }]) {
    const token = parts[0] + '.' + Buffer.from(JSON.stringify(altered)).toString('base64url') + '.' + parts[2];
    await expect(f.auth.verify(token)).rejects.toMatchObject({ statusCode: 401 });
  }
  expect((await f.app.inject({ url: '/api/account/session', headers: { authorization: 'Bearer ' + f.token, 'x-little-say-account': randomUUID() } })).statusCode).toBe(401);
  await f.admin.updateUser(f.uid, { disabled: true });
  await expect(f.auth.verify(f.token)).rejects.toMatchObject({ statusCode: 401 });
  expect(session.json().account.id).toMatch(/^[a-f0-9-]{36}$/);
});
it('supports Firebase verification and password reset email actions', async () => {
  const f = await setup();
  await rest('accounts:sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: f.token });
  await rest('accounts:sendOobCode', { requestType: 'PASSWORD_RESET', email: f.email });
  const response = await fetch('http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST + '/emulator/v1/projects/' + project + '/oobCodes');
  const codes = (await response.json()).oobCodes.filter((value: { email: string }) => value.email === f.email);
  const verification = codes.find((value: { requestType: string }) => value.requestType === 'VERIFY_EMAIL');
  await rest('accounts:update', { oobCode: verification.oobCode });
  expect((await f.admin.getUser(f.uid)).emailVerified).toBe(true);
  const reset = codes.find((value: { requestType: string }) => value.requestType === 'PASSWORD_RESET');
  await rest('accounts:resetPassword', { oobCode: reset.oobCode, newPassword: 'the replacement passphrase' });
  await expect(rest('accounts:signInWithPassword', { email: f.email, password: f.password, returnSecureToken: true })).rejects.toThrow();
  expect((await rest('accounts:signInWithPassword', { email: f.email, password: 'the replacement passphrase', returnSecureToken: true })).localId).toBe(f.uid);
});
it('requires matching recent reauthentication, deletes the shared identity, and removes this backend backup', async () => {
  const f = await setup(); const login = await native(f); await f.admin.updateUser(f.uid, { emailVerified: true });
  const access = { ...headers, authorization: 'Bearer ' + f.token, 'x-little-say-account': login.json().account.id };
  const parts = f.token.split('.'), oldClaims = JSON.parse(Buffer.from(parts[1], 'base64url').toString()); oldClaims.auth_time = Math.floor(Date.now() / 1000) - 600;
  const old = parts[0] + '.' + Buffer.from(JSON.stringify(oldClaims)).toString('base64url') + '.' + parts[2];
  expect((await f.app.inject({ method: 'POST', url: '/api/account/delete', headers: access, payload: { idToken: old } })).statusCode).toBe(401);
  expect((await f.app.inject({ method: 'POST', url: '/api/account/delete', headers: access, payload: { idToken: f.token } })).statusCode).toBe(202);
  expect((await f.app.inject({ url: '/api/account/backup', headers: access })).statusCode).toBe(410);
  await f.accounts.processDeletions(project, uid => f.auth.deleteUser(uid));
  await expect(f.auth.verify(f.token)).rejects.toMatchObject({ statusCode: 401 });
  await f.auth.deleteUser(f.uid);
});
it('fails closed for emulator settings in production and for demo identities without emulation', () => {
  expect(() => firebaseConfig({ NODE_ENV: 'production', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' })).toThrow('forbidden');
  expect(() => firebaseConfig({ FIREBASE_PROJECT_ID: 'demo-little-say' })).toThrow();
  expect(() => firebaseConfig({ FIREBASE_AUTH_EMULATOR_HOST: 'https://evil.invalid:9099' })).toThrow();
  for (const NODE_ENV of ['development', 'test', 'production']) {
    expect(firebaseConfig({ NODE_ENV, FIREBASE_PROJECT_ID: 'hosted-little-say', FIREBASE_API_KEY: 'public-key', FIREBASE_APP_ID: 'public-app' }).developmentAccount).toBeUndefined();
  }
  for (const NODE_ENV of ['test', undefined]) {
    expect(firebaseConfig({ NODE_ENV, FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' }).developmentAccount).toBeUndefined();
  }
  expect(firebaseConfig({ NODE_ENV: 'development', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIREBASE_AUTH_PROVIDERS: 'google.com' }).developmentAccount).toBeUndefined();
});

it('prepares a verified development account once and reuses its ordinary native and browser sessions', async () => {
  const f = await setup('development');
  const config = (await f.app.inject('/api/account/config')).json();
  expect(config.developmentAccount).toEqual({ email: 'tester@little-say.test', password: 'little-say-local-test-only' });
  await Promise.all([f.auth.prepareDevelopmentAccount(), f.auth.prepareDevelopmentAccount()]);
  const user = await f.admin.getUserByEmail(config.developmentAccount.email);
  cleanup.push(() => f.admin.deleteUser(user.uid));
  expect(user.emailVerified).toBe(true);
  const first = await rest('accounts:signInWithPassword', { ...config.developmentAccount, returnSecureToken: true });
  const login = await native({ ...f, token: first.idToken });
  expect(login.statusCode).toBe(200);
  const account = login.json().account;
  expect(account).toMatchObject({ email: config.developmentAccount.email, emailVerified: true, providers: ['password'] });
  const restarted = new FirebaseIdentity({ ...process.env, NODE_ENV: 'development', FIREBASE_PROJECT_ID: project, FIREBASE_AUTH_PROVIDERS: 'password' });
  cleanup.push(() => restarted.close());
  await restarted.prepareDevelopmentAccount();
  const second = await rest('accounts:signInWithPassword', { ...config.developmentAccount, returnSecureToken: true });
  expect(second.localId).toBe(user.uid);
  expect((await browser({ ...f, token: second.idToken })).login.json().account.id).toBe(account.id);
  expect((await f.app.inject({ url: '/api/account/backup', headers: { authorization: 'Bearer ' + second.idToken } })).statusCode).toBe(200);
});

it('links providers only to the authenticated UID and preserves both accounts on credential conflict', async () => {
  const f = await setup();
  const firstApp = clientApp({ projectId: project, apiKey: 'demo-key' }, randomUUID());
  const secondApp = clientApp({ projectId: project, apiKey: 'demo-key' }, randomUUID());
  cleanup.push(() => deleteClientApp(firstApp), () => deleteClientApp(secondApp));
  const first = initializeAuth(firstApp, { persistence: inMemoryPersistence });
  const second = initializeAuth(secondApp, { persistence: inMemoryPersistence });
  connectAuthEmulator(first, 'http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST, { disableWarnings: true });
  connectAuthEmulator(second, 'http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST, { disableWarnings: true });
  const user = (await signInWithEmailAndPassword(first, f.email, f.password)).user;
  const credential = GoogleAuthProvider.credential(JSON.stringify({ sub: randomUUID(), email: randomUUID() + '@example.test', email_verified: true }));
  const linked = await linkWithCredential(user, credential);
  expect(linked.user.uid).toBe(f.uid);
  expect(linked.user.providerData.map(value => value.providerId)).toEqual(expect.arrayContaining(['password', 'google.com']));
  expect((await signInWithCredential(second, credential)).user.uid).toBe(f.uid);
  const otherEmail = randomUUID() + '@example.test';
  const other = await f.admin.createUser({ email: otherEmail, password: f.password });
  cleanup.push(() => f.admin.deleteUser(other.uid));
  await signInWithEmailAndPassword(second, otherEmail, f.password);
  await expect(linkWithCredential(second.currentUser!, credential)).rejects.toMatchObject({ code: 'auth/credential-already-in-use' });
  expect(second.currentUser!.uid).toBe(other.uid);
  expect((await f.admin.getUser(f.uid)).providerData.map(value => value.providerId)).toContain('google.com');
});
