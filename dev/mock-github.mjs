// Tiruan kecil GitHub REST API (contents, blobs, commits) untuk uji lokal. Aturan sha sama dengan GitHub:
//   PUT tanpa sha pada file yang sudah ada → 422; PUT/DELETE dengan sha lama → 409
import http from 'node:http';
import { createHash } from 'node:crypto';
export function startMockGitHub({ port = 0, token = 'github_pat_uji_lokal_0123456789', isPrivate = true, raceRate = 0 } = {}) {
  const files = new Map();   // path → { sha, text }
  const blobs = new Map();   // sha → text
  let head = '', n = 0;
  const gitSha = (t) => createHash('sha1').update(`blob ${Buffer.byteLength(t)}\0`).update(t).digest('hex');
  const commit = () => { head = createHash('sha1').update(String(++n)).digest('hex'); };
  const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,PUT,DELETE,OPTIONS', 'access-control-expose-headers': 'date', date: new Date().toUTCString() }); res.end(body === undefined ? '' : JSON.stringify(body)); };
  const srv = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204);
    if ((req.headers.authorization || '') !== `Bearer ${token}`) return send(res, 401, { message: 'Bad credentials' });
    const u = new URL(req.url, 'http://x');
    const m = u.pathname.match(/^\/repos\/([^/]+\/[^/]+)(\/.*)?$/);
    if (!m) return send(res, 404, { message: 'Not Found' });
    const sub = m[2] || '';
    let body = ''; for await (const c of req) body += c;
    const j = body ? JSON.parse(body) : {};
    if (!sub) return send(res, 200, { full_name: m[1], private: isPrivate, default_branch: 'main', permissions: { push: true } });
    if (sub === '/commits/main') return head ? send(res, 200, { sha: head }) : send(res, 409, { message: 'Git Repository is empty.' });
    let b = sub.match(/^\/git\/blobs\/(\w+)$/);
    if (b) return blobs.has(b[1]) ? send(res, 200, { sha: b[1], content: Buffer.from(blobs.get(b[1])).toString('base64'), encoding: 'base64' }) : send(res, 404, { message: 'Not Found' });
    const c = sub.match(/^\/contents\/?(.*)$/);
    if (!c) return send(res, 404, { message: 'Not Found' });
    const path = decodeURIComponent(c[1]);
    if (req.method === 'GET') {
      const f = files.get(path);
      if (f) return send(res, 200, { type: 'file', path, sha: f.sha, content: Buffer.from(f.text).toString('base64'), encoding: 'base64' });
      const pre = path ? path + '/' : '';
      const kids = [...files.entries()].filter(([p]) => p.startsWith(pre) && !p.slice(pre.length).includes('/')).map(([p, f2]) => ({ type: 'file', path: p, sha: f2.sha }));
      const dirs = new Set([...files.keys()].filter((p) => p.startsWith(pre) && p.slice(pre.length).includes('/')).map((p) => pre + p.slice(pre.length).split('/')[0]));
      if (!kids.length && !dirs.size) return send(res, 404, { message: 'Not Found' });
      return send(res, 200, [...kids, ...[...dirs].map((d) => ({ type: 'dir', path: d, sha: 'dir' }))]);
    }
    if (raceRate && Math.random() < raceRate) return send(res, 409, { message: 'main is at abc but expected def' });   // tulis bersamaan ke branch
    const f = files.get(path);
    if (req.method === 'PUT') {
      if (f && !j.sha) return send(res, 422, { message: '"sha" wasn\'t supplied.' });
      if (f && j.sha !== f.sha) return send(res, 409, { message: `${path} does not match ${j.sha}` });
      if (!f && j.sha) return send(res, 409, { message: 'sha does not match' });
      const text = Buffer.from(j.content, 'base64').toString();
      const sha = gitSha(text); files.set(path, { sha, text }); blobs.set(sha, text); commit();
      return send(res, f ? 200 : 201, { content: { path, sha } });
    }
    if (req.method === 'DELETE') {
      if (!f) return send(res, 404, { message: 'Not Found' });
      if (j.sha !== f.sha) return send(res, 409, { message: 'sha does not match' });
      files.delete(path); commit(); return send(res, 200, { commit: {} });
    }
    send(res, 405, {});
  });
  return new Promise((ok) => srv.listen(port, () => ok({ url: `http://localhost:${srv.address().port}`, close: () => srv.close(), files, token })));
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await startMockGitHub({ port: Number(process.env.PORT || 8890) });
  console.log('mock GitHub ' + s.url);
}
