// Uji lokal tanpa internet: halaman public/ di http://localhost:8888 + tiruan GitHub API di http://localhost:8890
// Sambungkan perangkat dengan repository "kaly/denah-data" dan kunci "github_pat_uji_lokal_0123456789".
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startMockGitHub } from './mock-github.mjs';
const ROOT = path.resolve(new URL('../public', import.meta.url).pathname);
const PORT = Number(process.env.PORT || 8888), GH = Number(process.env.GH_PORT || 8890);
let gh = await startMockGitHub({ port: GH });
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__reset') { gh.close(); gh = await startMockGitHub({ port: GH }); res.end('ok'); return; }
  let p = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!p.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (url.pathname.endsWith('/')) p = path.join(p, 'index.html');
  try {
    let body = await fs.readFile(p);
    if (p.endsWith('index.html')) body = Buffer.from(String(body).replace('<head>', `<head><script>globalThis.KALY_GH_API = 'http://localhost:${GH}';</script>`));
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(PORT, () => console.log(`Denah Service lokal: http://localhost:${PORT}  (tiruan GitHub ${GH}, repo kaly/denah-data, kunci github_pat_uji_lokal_0123456789)`));
