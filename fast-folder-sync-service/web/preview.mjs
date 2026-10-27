import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../frontend');
const target = new URL(process.env.FFS_PROXY_TARGET || 'http://127.0.0.1:9000');
if (target.protocol !== 'http:') throw Error('Local preview proxy expects an HTTP development server');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.ttf': 'font/ttf' };
http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    const proxy = http.request(new URL(req.url, target), { method: req.method, headers: { ...req.headers, host: target.host } }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
    proxy.on('error', () => { res.writeHead(502); res.end('Start the Go service first'); }); req.pipe(proxy); return;
  }
  const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.resolve(root, name === '/' || name === '/webgui/' ? 'index.html' : '.' + name);
  if (!file.startsWith(root + path.sep)) { res.writeHead(400); res.end(); return; }
  try { res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(await fs.readFile(file)); }
  catch { res.writeHead(404); res.end(); }
}).listen(4173, '127.0.0.1', () => console.log('Console: http://127.0.0.1:4173 — API proxy: ' + target.origin));
