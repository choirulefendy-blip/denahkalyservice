// Penyimpanan data Denah Service di repository GitHub PRIVAT (lewat GitHub REST API, dari browser).
// Setiap catatan = satu file JSON. Tulis bersyarat memakai "sha" file supaya dua perangkat tidak saling menimpa:
//   create  → gagal bila file sudah ada (dipakai untuk mengunci meja)
//   update  → gagal bila file sudah diubah perangkat lain (sha berbeda)
const API = () => (globalThis.KALY_GH_API || 'https://api.github.com');

export class Conflict extends Error { constructor(m = 'conflict') { super(m); this.conflict = true; } }

const b64e = (s) => { const b = new TextEncoder().encode(s); let x = ''; for (let i = 0; i < b.length; i += 0x8000) x += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(x); };
const b64d = (s) => new TextDecoder().decode(Uint8Array.from(atob(String(s).replace(/\s/g, '')), (c) => c.charCodeAt(0)));
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

export class GhStore {
  constructor({ repo, token, branch = 'main' }) {
    this.repo = repo; this.token = token; this.branch = branch;
    this.blobs = new Map();            // isi file per sha (tidak pernah berubah) → hemat kuota API
    this.queue = Promise.resolve();    // tulis dari perangkat ini dijalankan satu per satu
    this.serverNow = null;
  }
  async req(method, path, body) {
    let r;
    try {
      r = await fetch(`${API()}/repos/${this.repo}${path}`, {
        method, cache: 'no-store',
        headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${this.token}`, 'x-github-api-version': '2022-11-28', ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch { const e = new Error('Tidak tersambung ke internet. Cek koneksi, lalu coba lagi.'); e.offline = true; throw e; }
    const d = r.headers.get('date'); if (d) this.serverNow = Date.parse(d);
    if (r.status === 401) { const e = new Error('Kunci GitHub perangkat ini tidak berlaku lagi. Minta admin menyambungkan ulang perangkat.'); e.auth = true; throw e; }
    if (r.status === 403 && r.headers.get('x-ratelimit-remaining') === '0') throw new Error('Batas akses GitHub per jam habis. Tunggu beberapa menit, lalu coba lagi.');
    return r;
  }
  // Satu file: { data, sha } atau null
  async get(path) {
    const r = await this.req('GET', `/contents/${enc(path)}?ref=${this.branch}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('Gagal membaca data (' + r.status + ')');
    const j = await r.json();
    let text;
    if (j.content && j.encoding === 'base64') text = b64d(j.content);
    else text = await this.blobText(j.sha);
    const data = JSON.parse(text);
    this.blobs.set(j.sha, data);
    return { data, sha: j.sha };
  }
  async blobText(sha) {
    const r = await this.req('GET', `/git/blobs/${sha}`);
    if (!r.ok) throw new Error('Gagal membaca data (' + r.status + ')');
    return b64d((await r.json()).content);
  }
  // Isi file berdasarkan sha (dari daftar folder)
  async bySha(sha) {
    if (this.blobs.has(sha)) return this.blobs.get(sha);
    const data = JSON.parse(await this.blobText(sha));
    this.blobs.set(sha, data);
    return data;
  }
  // Daftar file dalam folder: [{ path, sha }]
  async list(dir) {
    const r = await this.req('GET', `/contents/${enc(dir)}?ref=${this.branch}`);
    if (r.status === 404) return [];
    if (!r.ok) throw new Error('Gagal membaca data (' + r.status + ')');
    const j = await r.json();
    return Array.isArray(j) ? j.filter((x) => x.type === 'file').map((x) => ({ path: x.path, sha: x.sha })) : [];
  }
  // Tulis bersyarat. opts.create = hanya bila belum ada; opts.sha = hanya bila belum diubah. Kembali: sha baru.
  put(path, data, opts = {}, msg = 'Denah Service') {
    return this.serial(async () => {
      const body = { message: msg, content: b64e(JSON.stringify(data)), branch: this.branch };
      let sha = opts.sha;
      if (!opts.create && !sha) sha = (await this.head(path))?.sha;   // tulis bebas: timpa versi terakhir
      for (let i = 0; i < 6; i++) {
        const r = await this.req('PUT', `/contents/${enc(path)}`, sha ? { ...body, sha } : body);
        if (r.ok) { const j = await r.json(); this.blobs.set(j.content.sha, data); return j.content.sha; }
        if (r.status === 409 || r.status === 422) {
          // 409 bisa karena dua perangkat menulis bersamaan ke repository (bukan ke file yang sama) → ulangi
          const cur = await this.head(path);
          if (opts.create && cur) throw new Conflict();
          if (opts.sha && (!cur || cur.sha !== opts.sha)) throw new Conflict();
          if (!opts.create && !opts.sha) sha = cur?.sha;
          await new Promise((ok) => setTimeout(ok, 300 + Math.random() * 500 * (i + 1)));
          continue;
        }
        throw new Error('Gagal menyimpan ke GitHub (' + r.status + ')');
      }
      throw new Conflict('busy');
    });
  }
  del(path, sha, msg = 'Denah Service: hapus') {
    return this.serial(async () => {
      for (let i = 0; i < 6; i++) {
        const cur = sha ? { sha } : await this.head(path);
        if (!cur) return false;
        const r = await this.req('DELETE', `/contents/${enc(path)}`, { message: msg, sha: cur.sha, branch: this.branch });
        if (r.ok || r.status === 404) return true;
        if (r.status === 409 || r.status === 422) { sha = null; await new Promise((ok) => setTimeout(ok, 300 + Math.random() * 500 * (i + 1))); continue; }
        throw new Error('Gagal menghapus (' + r.status + ')');
      }
      throw new Conflict('busy');
    });
  }
  // sha file saat ini (tanpa mengunduh isi besar) atau null
  async head(path) {
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const list = await this.list(dir);
    return list.find((x) => x.path === path) || null;
  }
  // Sha commit terakhir di branch: berubah bila ada data apa pun yang berubah
  async rev() {
    const r = await this.req('GET', `/commits/${this.branch}`);
    if (r.status === 404 || r.status === 409) return '';   // repository masih kosong
    if (!r.ok) throw new Error('Gagal membaca data (' + r.status + ')');
    return (await r.json()).sha;
  }
  // Cek akses: repository ada, bisa ditulis, dan privat
  async check() {
    const r = await this.req('GET', '');
    if (r.status === 404) throw new Error('Repository tidak ditemukan. Cek nama repository dan izin kunci GitHub.');
    if (!r.ok) throw new Error('Tidak bisa membuka repository (' + r.status + ')');
    const j = await r.json();
    if (j.permissions && !j.permissions.push) throw new Error('Kunci GitHub ini hanya bisa membaca. Beri izin Contents: Read and write.');
    this.branch = j.default_branch || this.branch;
    return { private: !!j.private, branch: this.branch, name: j.full_name };
  }
  serial(fn) { const p = this.queue.then(fn, fn); this.queue = p.catch(() => {}); return p; }
}
