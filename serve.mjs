/** @file Serves isolated baseline and candidate exports on loopback for synthetic browser evidence. */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
for (const [port, folder] of [[4276, 'little-say'], [4277, 'before']]) {
  const root = resolve(folder, 'apps/mobile/dist');
  createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (path === '/app' || path === '/') path = '/index.html';
    const file = resolve(root, '.' + path);
    if (!file.startsWith(root) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' })[extname(file)] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  }).listen(port, '127.0.0.1', () => console.log(`${folder}: ${port} ${root}`));
}
