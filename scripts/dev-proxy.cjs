/** @file Streams development web API calls through Metro to one fixed backend without changing deployed CORS policy. */

const http = require('node:http');
const https = require('node:https');

/**
 * Create Connect middleware for /api/ only. Accept trusted development origins and the app's POST
 * header, strip unrelated credentials/origin, and stream bodies and assets to a fixed HTTP(S) origin.
 * Only account endpoints relay Little Say's own HttpOnly session cookie and account identity header.
 * The caller owns the HTTP server; disconnected clients cancel their upstream request. Errors are
 * sanitized and redirects are rejected so a backend cannot turn this into an arbitrary URL proxy.
 * @param {string} backendUrl Backend origin, never a client-provided URL.
 * @param {string[]} origins Exact development browser origins allowed to call the proxy.
 * @returns {import('connect').NextHandleFunction} Middleware that leaves non-API requests to Metro.
 */
function createDevelopmentApiProxy(backendUrl, origins) {
  const backend = new URL(backendUrl);
  if (!['http:', 'https:'].includes(backend.protocol) || backend.username || backend.password || backend.pathname !== '/' || backend.search || backend.hash) throw new Error('The development proxy requires an HTTP(S) origin.');
  const transport = backend.protocol === 'https:' ? https : http;
  return (request, response, next) => {
    if (!request.url?.startsWith('/api/')) return next();
    const fail = (status, message) => {
      if (response.destroyed || response.writableEnded) return;
      if (response.headersSent) { response.destroy(); return; }
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ error: message }));
    };
    if ((request.headers.origin && !origins.includes(request.headers.origin)) || (request.method === 'POST' && request.headers['x-little-say'] !== '1')) {
      fail(403, 'Use the local Little Say development app to make this request.'); return;
    }
    if (!['GET', 'HEAD', 'POST'].includes(request.method)) { fail(405, 'Unsupported development API method.'); return; }
    const target = new URL(request.url, backend);
    if (target.origin !== backend.origin || !target.pathname.startsWith('/api/')) { fail(400, 'Invalid development API path.'); return; }
    const headers = {};
    for (const name of ['content-type', 'content-length', 'x-little-say', 'accept', 'range', 'if-none-match', 'if-modified-since']) {
      if (request.headers[name] !== undefined) headers[name] = request.headers[name];
    }
    const accountRequest = target.pathname.startsWith('/api/account/');
    if (accountRequest) {
      const session = /(?:^|;\s*)(little_say_session=[a-f0-9]{64})(?:;|$)/.exec(request.headers.cookie || '');
      if (session) headers.cookie = session[1];
      if (request.headers['x-little-say-account']) headers['x-little-say-account'] = request.headers['x-little-say-account'];
    }
    const upstream = transport.request(target, { method: request.method, headers }, incoming => {
      if (incoming.statusCode >= 300 && incoming.statusCode < 400 && incoming.statusCode !== 304) {
        incoming.resume(); fail(502, 'The self-hosted API redirected this request. Check its configured origin.'); return;
      }
      const outgoing = {};
      for (const name of ['content-type', 'content-length', 'content-encoding', 'cache-control', 'etag', 'last-modified', 'content-range', 'accept-ranges', 'retry-after']) {
        if (incoming.headers[name] !== undefined) outgoing[name] = incoming.headers[name];
      }
      if (accountRequest && incoming.headers['set-cookie']) {
        // Metro uses HTTP on the trusted development LAN. Production never passes through this proxy.
        outgoing['set-cookie'] = incoming.headers['set-cookie'].filter(value => /^little_say_session=/.test(value)).map(value => value.replace(/;\s*Secure\b/gi, ''));
      }
      response.writeHead(incoming.statusCode || 502, outgoing);
      incoming.once('error', () => response.destroy());
      response.once('close', () => incoming.destroy());
      incoming.pipe(response);
    });
    upstream.setTimeout(65000, () => upstream.destroy(new Error('API timeout')));
    upstream.once('error', () => fail(502, 'The self-hosted API could not be reached. Check its service and network connection.'));
    request.once('aborted', () => upstream.destroy());
    request.once('error', () => upstream.destroy());
    response.once('close', () => { if (!response.writableFinished) upstream.destroy(); });
    request.pipe(upstream);
  };
}

module.exports = { createDevelopmentApiProxy };
