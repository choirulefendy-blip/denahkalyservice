// Server uji lokal: file statis public/ + fungsi netlify/functions/api.mjs + Netlify Blobs lokal (BlobsServer asli)
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BlobsServer } from '@netlify/blobs/server';

import { createHash } from 'node:crypto';
// Penyesuaian emulator lokal supaya perilakunya sama dengan Netlify Blobs sungguhan:
// ETag ikut dikirim saat membaca, ETag berbasis isi file, dan tulis bersyarat berjalan atomik (satu per satu).
BlobsServer.generateETag = async (p) => { try { return '"' + createHash('sha256').update(p).update(await fs.readFile(p)).digest('hex') + '"'; } catch { return ''; } };
const _get = BlobsServer.prototype.get, _put = BlobsServer.prototype.put, _del = BlobsServer.prototype.delete;
BlobsServer.prototype.get = async function (req) {
  const res = await _get.call(this, req);
  try {
    const m = this.parseAPIRequest(req); const { dataPath, key } = this.getLocalPaths(m?.url ?? new URL(req.url ?? '', this.address));
    if (key && res.status === 200) { const h = new Headers(res.headers); h.set('etag', await BlobsServer.generateETag(dataPath)); return new Response(res.body, { status: 200, headers: h }); }
  } catch {}
  return res;
};
let queue = Promise.resolve();
const serial = (fn) => function (req) { const p = queue.then(() => fn.call(this, req)); queue = p.catch(() => {}); return p; };
BlobsServer.prototype.put = serial(_put); BlobsServer.prototype.delete = serial(_del);
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PORT = Number(process.env.PORT || 8888);
const token = 'uji-lokal';
const blobsDir = process.env.BLOBS_DIR || path.join(ROOT, 'dev', '.blobs');
const blobs = new BlobsServer({ directory: blobsDir, token });
const { port: bport } = await blobs.start();
const edge = `http://localhost:${bport}`;
process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({ edgeURL: edge, uncachedEdgeURL: edge, siteID: 'kaly-denah-lokal', token })).toString('base64');
const { default: handler } = await import(path.join(ROOT, 'netlify/functions/api.mjs'));

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8' };
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname === '/__reset') { await fs.rm(blobsDir, { recursive: true, force: true }); await fs.mkdir(blobsDir, { recursive: true }); res.end('ok'); return; }  // hanya server uji
    if (url.pathname.startsWith('/api/')) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const r = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
      const out = await handler(r, { ip: req.headers['x-test-ip'] || req.socket.remoteAddress });
      res.writeHead(out.status, Object.fromEntries(out.headers));
      res.end(Buffer.from(await out.arrayBuffer()));
      return;
    }
    let p = path.join(ROOT, 'public', decodeURIComponent(url.pathname));
    if (!p.startsWith(path.join(ROOT, 'public'))) { res.writeHead(403); return res.end(); }
    try { if ((await fs.stat(p)).isDirectory()) p = path.join(p, 'index.html'); } catch { p = path.join(ROOT, 'public', 'index.html'); }
    const data = await fs.readFile(p);
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  } catch (e) { console.error(e); res.writeHead(500); res.end(String(e)); }
}).listen(PORT, () => console.log(`Kaly Denah lokal: http://localhost:${PORT}  (blobs ${edge})`));
