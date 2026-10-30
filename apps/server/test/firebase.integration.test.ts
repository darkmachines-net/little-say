/** @file Verifies guest/account Auth-emulator credentials, session renewal, CSRF, revocation, backups, and deletion. */
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
async function setup() {
  if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')) throw new Error('Start the local Auth emulator and set FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099.');
  const db = await testDatabase(); cleanup.push(() => db.close());
  const adminApp = initializeApp({ projectId: project }, randomUUID()), admin = getAuth(adminApp); cleanup.push(() => deleteApp(adminApp));
  const auth = new FirebaseIdentity({ ...process.env, NODE_ENV: 'test', FIREBASE_PROJECT_ID: project, FIREBASE_API_KEY: 'demo-key', FIREBASE_APP_ID: 'demo-app', FIREBASE_AUTH_PROVIDERS: 'password' });
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

it('keeps guest APIs available and gates backup on verified email with no password endpoint', async () => {
  const f = await setup(); expect((await f.app.inject('/api/health')).statusCode).toBe(200);
  expect((await f.app.inject('/api/account/backup')).statusCode).toBe(401);
  expect((await native(f)).statusCode).toBe(200);
  const access = { ...headers, authorization: 'Bearer ' + f.token };
  expect((await f.app.inject({ url: '/api/account/backup', headers: access })).statusCode).toBe(403);
  await f.admin.updateUser(f.uid, { emailVerified: true });
  expect((await f.app.inject({ url: '/api/account/backup', headers: access })).statusCode).toBe(200);
  expect((await f.app.inject({ method: 'POST', url: '/api/account/register', headers, payload: {} })).statusCode).toBe(404);
});
it('restores persisted native guests without recent sign-in and rejects account credentials disguised as guests', async () => {
  const f = await setup();
  const guest = await rest('accounts:signUp', { returnSecureToken: true });
  cleanup.push(() => f.admin.deleteUser(guest.localId));
  expect(await f.auth.verify(guest.idToken)).toMatchObject({ anonymous: true, email: null, emailVerified: false });
  // The emulator permits editing this unsigned claim to model a refreshed ID token from an older guest login.
  const parts = guest.idToken.split('.'), claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  claims.auth_time -= 86400;
  const token = parts[0] + '.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.' + parts[2];
  const request = { method: 'POST' as const, url: '/api/account/session', headers, payload: { idToken: token, native: true, guest: true } };
  const first = await f.app.inject(request), second = await f.app.inject(request);
  expect(first.statusCode).toBe(200); expect(second.json().account.id).toBe(first.json().account.id);
  expect((await f.app.inject({ url: '/api/account/backup', headers: { authorization: 'Bearer ' + token } })).statusCode).toBe(403);
  expect((await f.app.inject({ ...request, payload: { ...request.payload, idToken: f.token } })).statusCode).toBe(403);
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
