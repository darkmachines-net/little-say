/** @file Verifies development proxy origin checks, request/body forwarding, binary assets, and failure isolation. */

import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type RequestListener, type Server } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';

const { createDevelopmentApiProxy } = createRequire(import.meta.url)('./dev-proxy.cjs') as {
  createDevelopmentApiProxy: (backend: string, origins: string[]) => (req: Parameters<RequestListener>[0], res: Parameters<RequestListener>[1], next: () => void) => void;
};
const servers: Server[] = [];
const origin = 'http://localhost:8081';
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); }))); });

async function listen(listener: RequestListener) {
  const server = createServer(listener); servers.push(server);
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function proxy(backend: string) {
  const handler = createDevelopmentApiProxy(backend, [origin]);
  return listen((req, res) => handler(req, res, () => { res.end('Metro'); }));
}

describe('remote development web proxy', () => {
  it.each(['/api/account/session', '/api/ai/jobs', '/api/pictures/assets/image.png', '/api/speech/audio.wav'])('relays only the opaque session and account identity on %s', async path => {
    const session = `__session=${'a'.repeat(64)}`;
    const local = await proxy(await listen((req, res) => {
      expect(req.headers.cookie).toBe(session); expect(req.headers.authorization).toBeUndefined();
      expect(req.headers['x-little-say-csrf']).toBe('b'.repeat(64));
      expect(req.headers['x-little-say-account']).toBe('account-id');
      res.setHeader('Set-Cookie', [`${session}; Path=/api; HttpOnly; SameSite=Strict; Secure`, 'unrelated=secret']); res.end('{}');
    }));
    const response = await fetch(`${local}${path}`, { headers: { Cookie: `private=1; ${session}; little_say_csrf=legacy`, Authorization: 'other-credential', 'X-Little-Say-Account': 'account-id', 'X-Little-Say-CSRF': 'b'.repeat(64) } });
    expect(response.headers.get('set-cookie')).toBe(`${session}; Path=/api; HttpOnly; SameSite=Strict`);
  });
  it('forwards paths, queries, app headers and JSON bytes without browser credentials or origin', async () => {
    const backend = await listen(async (req, res) => {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ url: req.url, method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString('base64') }));
    });
    const local = await proxy(backend);
    const body = Buffer.from(JSON.stringify({ prompt: 'Cow', board: null }));
    const response = await fetch(`${local}/api/boards/propose?test=1`, { method: 'POST', headers: { Origin: origin, 'X-Little-Say': '1', 'Content-Type': 'application/json', Cookie: 'private=1', Authorization: 'secret' }, body });
    const received = await response.json();
    expect(received).toMatchObject({ url: '/api/boards/propose?test=1', method: 'POST', body: body.toString('base64'), headers: { 'x-little-say': '1', 'content-type': 'application/json' } });
    for (const header of ['origin', 'cookie', 'authorization']) expect(received.headers[header]).toBeUndefined();
  });
  it('streams binary assets and preserves upstream status, ranges, and content headers', async () => {
    const bytes = Buffer.from([0, 255, 1, 128]);
    const local = await proxy(await listen((req, res) => {
      expect(req.headers.range).toBe('bytes=0-3');
      res.writeHead(206, { 'Content-Type': 'audio/wav', 'Content-Range': 'bytes 0-3/4', 'Set-Cookie': 'private=1' }); res.end(bytes);
    }));
    const response = await fetch(`${local}/api/speech/clip.wav`, { headers: { Range: 'bytes=0-3' } });
    expect(response.status).toBe(206); expect(response.headers.get('content-range')).toBe('bytes 0-3/4');
    expect(response.headers.get('set-cookie')).toBeNull(); expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });
  it('rejects untrusted origins, missing POST app headers, and methods before contacting the backend', async () => {
    let hits = 0;
    const local = await proxy(await listen((_req, res) => { hits++; res.end('backend'); }));
    expect((await fetch(`${local}/api/health`, { headers: { Origin: 'https://untrusted.example' } })).status).toBe(403);
    expect((await fetch(`${local}/api/speech`, { method: 'POST', body: 'unsafe' })).status).toBe(403);
    expect((await fetch(`${local}/api/health`, { method: 'DELETE' })).status).toBe(405);
    expect(hits).toBe(0);
    expect(await (await fetch(`${local}/index.bundle`)).text()).toBe('Metro');
  });
  it('keeps API errors intact and rejects redirects without following them', async () => {
    const local = await proxy(await listen((req, res) => {
      if (req.url === '/api/redirect') { res.writeHead(302, { Location: 'https://untrusted.example' }); res.end(); return; }
      res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'AI unavailable' }));
    }));
    const error = await fetch(`${local}/api/health`);
    expect(error.status).toBe(503); expect(await error.json()).toEqual({ error: 'AI unavailable' });
    expect((await fetch(`${local}/api/redirect`)).status).toBe(502);
  });
  it('reports an unavailable upstream as a sanitized gateway error', async () => {
    const backend = await listen((_req, res) => res.end());
    await new Promise<void>(done => servers[servers.length - 1].close(() => done()));
    const response = await fetch(`${await proxy(backend)}/api/health`);
    expect(response.status).toBe(502); expect((await response.json()).error).toContain('self-hosted API could not be reached');
  });
});
