// "Server" Denah Service yang berjalan di browser. Aturannya sama dengan versi Netlify sebelumnya
// (kunci meja, tidak bisa dobel, PIN staf/admin, Atur meja), tetapi data disimpan di repository GitHub privat:
//   config.json          pengaturan, hash PIN, daftar meja hasil Atur meja
//   v/<tgl>/<id>.json    satu kunjungan (datang, pulang, catatan). <tgl> = tanggal datang (WIB)
//   t/<meja>.json        penanda meja sedang terisi → dua perangkat tidak bisa mengisi meja yang sama
//   snap/<tgl>.json      salinan riwayat satu hari yang sudah lewat (riwayat & ekspor lebih cepat)
import { GhStore, Conflict } from './github.js';
import { TABLES } from './tables.js';

const WIB = 7 * 3600 * 1000;
let skew = 0;
const now = () => Date.now() + skew;
const day = (ms = now()) => new Date(ms + WIB).toISOString().slice(0, 10);

export class Fail extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }
const fail = (msg, status) => { throw new Fail(msg, status); };
const clean = (x, n = 200) => String(x ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const validPin = (p) => /^\d{4,8}$/.test(String(p || ''));
const rand = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');

// ---------- PIN (PBKDF2, dicek di perangkat) ----------
async function pbkdf2(pin, salt, iter) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: iter }, k, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function hashPin(pin) { const salt = rand(16), iter = 150000; return { salt, iter, hash: await pbkdf2(pin, salt, iter) }; }
async function pinOk(pin, h) { if (!h?.salt) return false; return (await pbkdf2(pin, h.salt, h.iter || 150000)) === h.hash; }

// ---------- Meja ----------
const tableList = (cfg) => (Array.isArray(cfg?.tables) && cfg.tables.length ? cfg.tables : TABLES);
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const normTable = (t) => ({ id: t.id, area: clean(t.area, 40) || 'Lainnya', seats: Math.min(40, Math.max(1, Math.round(num(t.seats, 4)))),
  x: Math.round(Math.min(99, Math.max(1, num(t.x, 50))) * 100) / 100, y: Math.round(Math.min(99, Math.max(1, num(t.y, 50))) * 100) / 100, ...(t.gazebo ? { gazebo: true } : {}) });
const publicCfg = (c) => ({ staff: c.staff || [], pollSec: c.pollSec || 30, longMin: c.longMin || 120, tables: Array.isArray(c.tables) && c.tables.length ? c.tables : null, tokenVer: c.tokenVer || 1 });
const tablesOf = (v) => [v.table, ...(v.join || [])];
function checkTables(cfg, table, join) {
  const ids = [table, ...(join || [])].map((x) => clean(x, 8).toUpperCase());
  const known = new Set(tableList(cfg).map((t) => t.id));
  if (!ids.every((x) => known.has(x))) fail('Meja tidak dikenal');
  if (new Set(ids).size !== ids.length) fail('Meja dobel');
  return ids;
}
const timeOk = (ms, n = now()) => Number.isFinite(ms) && ms > n - 36 * 3600000 && ms < n + 10 * 60000;

// ---------- Sesi perangkat ----------
// Siapa pun yang memegang kunci GitHub perangkat bisa membaca & menulis data; PIN memisahkan peran staf/admin di aplikasi.
const sessionOf = (token) => { try { const p = JSON.parse(atob(token)); return p && p.e > Date.now() ? p : null; } catch { return null; } };
const makeToken = (cfg, role) => btoa(JSON.stringify({ r: role, v: cfg.tokenVer || 1, e: Date.now() + 90 * 86400000 }));

// ---------- CSV ----------
const fmtT = (ms) => (ms ? new Date(ms + WIB).toISOString().slice(11, 16) : '');
const csvCell = (x) => { const v = String(x ?? ''); return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
function toCsv(rows, cfg) {
  const AREA = Object.fromEntries(tableList(cfg).map((t) => [t.id, t.area]));
  const head = ['Tanggal', 'Meja', 'Meja gabungan', 'Area', 'Jumlah tamu', 'Nama / keterangan', 'Datang', 'Pulang', 'Lama duduk (menit)', 'Dicatat oleh', 'Dipulangkan oleh', 'Catatan'];
  const lines = rows.map((v) => [v.day, v.table, (v.join || []).join(' + '), AREA[v.table] || '', v.pax, v.name, fmtT(v.arriveAt), fmtT(v.leftAt),
    v.leftAt ? Math.round((v.leftAt - v.arriveAt) / 60000) : '', v.arriveBy, v.leftBy || '', (v.notes || []).map((n) => `${fmtT(n.at)} ${n.by ? n.by + ': ' : ''}${n.text}`).join(' | ')]);
  return '﻿sep=;\r\n' + [head, ...lines].map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

export class Backend {
  constructor(conn) { this.s = new GhStore(conn); this.cfg = null; this.cfgSha = null; this.rev = null; this.days = new Map(); }

  async loadCfg(force) {
    if (this.cfg && !force) return this.cfg;
    const r = await this.s.get('config.json');
    this.cfg = r?.data || null; this.cfgSha = r?.sha || null;
    if (this.s.serverNow) skew = this.s.serverNow - Date.now();
    return this.cfg;
  }
  async saveCfg(mut) {
    for (let i = 0; i < 6; i++) {
      const cur = await this.s.get('config.json');
      const next = mut(structuredClone(cur.data));
      try { this.cfgSha = await this.s.put('config.json', next, { sha: cur.sha }, 'Denah Service: pengaturan'); this.cfg = next; return next; }
      catch (e) { if (!(e instanceof Conflict)) throw e; }
    }
    fail('Pengaturan sedang diubah dari perangkat lain. Coba lagi.', 409);
  }
  async readVisit(key) { return this.s.get(key + '.json'); }
  async updateVisit(key, fn, msg) {
    for (let i = 0; i < 6; i++) {
      const cur = await this.readVisit(key);
      if (!cur) fail('Data kunjungan tidak ditemukan. Muat ulang halaman.', 404);
      const next = fn(structuredClone(cur.data));
      if (!next) return { data: cur.data, etag: cur.sha };
      next.updatedAt = now();
      try { const sha = await this.s.put(key + '.json', next, { sha: cur.sha }, msg); return { data: next, etag: sha }; }
      catch (e) { if (!(e instanceof Conflict)) throw e; }
    }
    fail('Data sedang diubah dari perangkat lain. Coba lagi.', 409);
  }
  // Kunci meja: t/<meja>.json hanya bisa dibuat kalau meja kosong
  async lockTables(ids, key) {
    const done = [];
    for (const id of ids) {
      const mk = `t/${id}.json`;
      let ok = false;
      try { await this.s.put(mk, { visit: key, at: now() }, { create: true }, `Meja ${id} terisi`); ok = true; }
      catch (e) {
        if (!(e instanceof Conflict)) { await this.unlockTables(done, key); throw e; }
        // Penanda lama yang kunjungannya sudah pulang/terhapus boleh ditimpa
        const m = await this.s.get(mk);
        const v = m?.data?.visit && (await this.readVisit(m.data.visit));
        // (penanda tanpa data kunjungan dianggap basi hanya bila sudah > 2 menit: perangkat lain mungkin sedang menulisnya)
        if (m && ((!v && now() - (m.data?.at || 0) > 120000) || v?.data.leftAt)) { try { await this.s.put(mk, { visit: key, at: now() }, { sha: m.sha }, `Meja ${id} terisi`); ok = true; } catch (e2) { if (!(e2 instanceof Conflict)) throw e2; } }
      }
      if (!ok) { await this.unlockTables(done, key); fail(`Meja ${id} sedang terisi. Muat ulang denah.`, 409); }
      done.push(id);
    }
  }
  async unlockTables(ids, key) {
    for (const id of ids) {
      const m = await this.s.get(`t/${id}.json`);
      if (m && m.data?.visit === key) await this.s.del(`t/${id}.json`, m.sha, `Meja ${id} kosong`).catch(() => {});
    }
  }
  async dayVisits(d) {
    const list = await this.s.list(`v/${d}`);
    const sig = list.map((b) => b.path + b.sha).sort().join('|');
    const past = d < day();
    if (past) {
      const snap = await this.s.get(`snap/${d}.json`);
      if (snap && snap.data.sig === sig) return snap.data.visits;
    }
    const visits = (await Promise.all(list.map((b) => this.s.bySha(b.sha)))).filter(Boolean).sort((a, b) => a.arriveAt - b.arriveAt);
    if (past && list.length) await this.s.put(`snap/${d}.json`, { sig, visits }, {}, `Riwayat ${d}`).catch(() => {});
    return visits;
  }

  // ---------- Rute (sama dengan /api/* versi lama) ----------
  async call(path, body = {}, token) {
    const [route, qs] = path.split('?');
    const q = new URLSearchParams(qs || '');
    // Lupa PIN admin: buat file reset-pin.txt di repository data → perangkat berikutnya membuat PIN baru
    // (daftar meja, petugas, dan riwayat tamu tetap)
    if (route === 'hello') { const c = await this.loadCfg(true); const reset = c ? !!(await this.s.head('reset-pin.txt')) : false; return { setup: !!c && !reset, reset, now: now(), today: day() }; }
    if (route === 'setup') {
      const old = await this.loadCfg(true);
      const reset = old && (await this.s.head('reset-pin.txt'));
      if (old && !reset) fail('Aplikasi sudah disiapkan. Masuk dengan PIN.', 403);
      if (!validPin(body.pinStaff) || !validPin(body.pinAdmin)) fail('PIN harus 4 sampai 8 angka');
      if (String(body.pinStaff) === String(body.pinAdmin)) fail('PIN staf dan PIN admin harus berbeda');
      const staff = [...new Set((body.staff || []).map((x) => clean(x, 40)).filter(Boolean))].slice(0, 60);
      const ps = await hashPin(body.pinStaff), pa = await hashPin(body.pinAdmin);
      let c;
      if (reset) {
        c = await this.saveCfg((x) => ({ ...x, pinStaff: ps, pinAdmin: pa, tokenVer: (x.tokenVer || 1) + 1, ...(staff.length ? { staff } : {}) }));
        await this.s.del('reset-pin.txt', reset.sha, 'PIN baru dibuat').catch(() => {});
      } else {
        c = { v: 2, pinStaff: ps, pinAdmin: pa, tokenVer: 1, staff, pollSec: 30, longMin: 120, createdAt: now() };
        try { this.cfgSha = await this.s.put('config.json', c, { create: true }, 'Denah Service disiapkan'); this.cfg = c; }
        catch (e) { if (e instanceof Conflict) fail('Aplikasi sudah disiapkan dari perangkat lain. Masuk dengan PIN.', 409); throw e; }
      }
      return { token: makeToken(c, 'admin'), role: 'admin', cfg: publicCfg(c) };
    }
    const cfg = await this.loadCfg();
    if (!cfg) fail('Aplikasi belum disiapkan', 428);

    if (route === 'login') {
      const pin = String(body.pin || '');
      const lk = JSON.parse(localStorage.getItem('kd.lock') || 'null');
      if (lk && lk.until > Date.now()) fail(`Terlalu banyak PIN salah. Coba lagi ${Math.ceil((lk.until - Date.now()) / 60000)} menit lagi.`, 429);
      const c = await this.loadCfg(true);
      const role = (await pinOk(pin, c.pinAdmin)) ? 'admin' : (await pinOk(pin, c.pinStaff)) ? 'staff' : null;
      if (!role) {
        const fails = (lk && Date.now() - lk.at < 15 * 60000 ? lk.fails : 0) + 1;
        try { localStorage.setItem('kd.lock', JSON.stringify({ fails, at: Date.now(), until: fails >= 5 ? Date.now() + 10 * 60000 : 0 })); } catch {}
        fail(fails >= 5 ? 'PIN salah 5 kali. Tunggu 10 menit.' : 'PIN salah', 401);
      }
      try { localStorage.removeItem('kd.lock'); } catch {}
      return { token: makeToken(c, role), role, cfg: publicCfg(c) };
    }

    const ses = sessionOf(token);
    if (!ses || ses.v !== (cfg.tokenVer || 1)) {
      // pengaturan bisa berubah (mis. "keluarkan semua perangkat"): baca ulang sekali sebelum menolak
      const c2 = await this.loadCfg(true);
      if (!ses || ses.v !== (c2.tokenVer || 1)) fail('Sesi habis. Masuk lagi dengan PIN.', 401);
    }
    const role = ses.r, admin = role === 'admin';
    const by = clean(body.by, 40);

    switch (route) {
      case 'me': return { role, cfg: publicCfg(this.cfg), now: now(), today: day() };

      // Sinkron: kunjungan hari ini & kemarin. Bila tidak ada perubahan sama sekali di repository, cukup 1 permintaan.
      case 'sync': {
        const known = body.known && typeof body.known === 'object' ? body.known : {};
        const rev = await this.s.rev();
        if (this.s.serverNow) skew = this.s.serverNow - Date.now();
        const days = [day(), day(now() - 86400000)];
        if (rev && rev === this.rev && this.daysKey === days.join() && Object.keys(known).length === this.lastKeys?.length && this.lastKeys.every((k) => known[k])) {
          return { now: now(), today: days[0], keys: this.lastKeys, changed: {}, cfg: publicCfg(this.cfg), role, same: true };
        }
        await this.loadCfg(true);
        if (ses.v !== (this.cfg.tokenVer || 1)) fail('Sesi habis. Masuk lagi dengan PIN.', 401);   // PIN direset / semua perangkat dikeluarkan
        const lists = await Promise.all(days.map((d) => this.s.list(`v/${d}`)));
        const blobs = lists.flat().map((b) => ({ key: b.path.replace(/\.json$/, ''), etag: b.sha }));
        const changed = {};
        await Promise.all(blobs.filter((b) => known[b.key] !== b.etag).map(async (b) => { changed[b.key] = { data: await this.s.bySha(b.etag), etag: b.etag }; }));
        this.rev = rev; this.daysKey = days.join(); this.lastKeys = blobs.map((b) => b.key);
        return { now: now(), today: days[0], keys: this.lastKeys, changed, cfg: publicCfg(this.cfg), role };
      }

      case 'arrive': {
        const ids = checkTables(cfg, body.table, body.join);
        const pax = Math.round(Number(body.pax));
        if (!(pax >= 1 && pax <= 200)) fail('Jumlah tamu 1 sampai 200');
        const at = body.at ? Number(body.at) : now();
        if (!timeOk(at)) fail('Jam datang tidak valid');
        const d = day(at);
        const id = Date.now().toString(36) + rand(3);
        const key = `v/${d}/${id}`;
        await this.lockTables(ids, key);
        const v = { id, key, day: d, table: ids[0], join: ids.slice(1), pax, name: clean(body.name, 80), arriveAt: at, arriveBy: by, leftAt: null, leftBy: '',
          notes: clean(body.note, 300) ? [{ at: now(), by, text: clean(body.note, 300) }] : [], createdAt: now(), updatedAt: now() };
        const sha = await this.s.put(key + '.json', v, { create: true }, `Tamu datang meja ${ids.join('+')}`);
        return { key, etag: sha, data: v };
      }
      case 'note': {
        const text = clean(body.text, 300);
        if (!text) fail('Catatan masih kosong');
        return { key: body.key, ...(await this.updateVisit(body.key, (v) => { v.notes = [...(v.notes || []), { at: now(), by, text }].slice(-50); return v; }, 'Catatan meja')) };
      }
      case 'note-del':
        return { key: body.key, ...(await this.updateVisit(body.key, (v) => { v.notes = (v.notes || []).filter((n) => n.at !== Number(body.at)); return v; }, 'Hapus catatan')) };
      case 'edit': {
        const p = body.patch || {};
        return { key: body.key, ...(await this.updateVisit(body.key, (v) => {
          if (v.leftAt && !admin && v.day < day()) fail('Kunjungan hari sebelumnya hanya bisa diubah admin', 403);
          if (p.pax != null) { const n = Math.round(Number(p.pax)); if (!(n >= 1 && n <= 200)) fail('Jumlah tamu 1 sampai 200'); v.pax = n; }
          if (p.name != null) v.name = clean(p.name, 80);
          if (p.arriveAt != null) { const t = Number(p.arriveAt); if (!timeOk(t) && !admin) fail('Jam datang tidak valid'); if (v.leftAt && t > v.leftAt) fail('Jam datang harus sebelum jam pulang'); v.arriveAt = t; }
          if (p.leftAt != null && v.leftAt) { const t = Number(p.leftAt); if (t < v.arriveAt) fail('Jam pulang harus sesudah jam datang'); v.leftAt = t; }
          return v;
        }, 'Ubah kunjungan')) };
      }
      case 'move': {
        const cur = await this.readVisit(body.key);
        if (!cur || cur.data.leftAt) fail('Tamu ini sudah pulang', 409);
        const ids = checkTables(cfg, body.table, body.join);
        const old = tablesOf(cur.data);
        const add = ids.filter((x) => !old.includes(x)), drop = old.filter((x) => !ids.includes(x));
        await this.lockTables(add, body.key);
        const r = await this.updateVisit(body.key, (v) => { v.table = ids[0]; v.join = ids.slice(1); return v; }, `Pindah ke meja ${ids.join('+')}`);
        await this.unlockTables(drop, body.key);
        return { key: body.key, ...r };
      }
      case 'leave': {
        const at = body.at ? Number(body.at) : now();
        const note = clean(body.note, 300);
        const r = await this.updateVisit(body.key, (v) => {
          if (v.leftAt) return null;
          if (!(at >= v.arriveAt - 60000) || at > now() + 10 * 60000) fail('Jam pulang harus sesudah jam datang');
          v.leftAt = Math.max(at, v.arriveAt); v.leftBy = by;
          if (note) v.notes = [...(v.notes || []), { at: now(), by, text: note }];
          return v;
        }, 'Tamu pulang');
        await this.unlockTables(tablesOf(r.data), body.key);
        return { key: body.key, ...r };
      }
      case 'reopen': {
        const cur = await this.readVisit(body.key);
        if (!cur || !cur.data.leftAt) fail('Kunjungan ini belum pulang');
        if (!admin && now() - cur.data.leftAt > 3 * 3600000) fail('Hanya bisa dibatalkan dalam 3 jam. Minta admin.', 403);
        await this.lockTables(tablesOf(cur.data), body.key);
        return { key: body.key, ...(await this.updateVisit(body.key, (v) => { v.leftAt = null; v.leftBy = ''; return v; }, 'Batal pulang')) };
      }
      case 'delete': {
        if (!admin) fail('Menghapus data hanya bisa dengan PIN admin', 403);
        const cur = await this.readVisit(body.key);
        if (cur) { await this.unlockTables(tablesOf(cur.data), body.key); await this.s.del(body.key + '.json', cur.sha, 'Hapus data kunjungan'); }
        return { key: body.key, deleted: true };
      }
      case 'day': {
        const d = String(q.get('d') || body.d || day());
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) fail('Tanggal tidak valid');
        return { day: d, visits: await this.dayVisits(d) };
      }
      case 'export': {
        const from = String(q.get('from') || body.from || ''), to = String(q.get('to') || body.to || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) fail('Rentang tanggal tidak valid');
        const days = [];
        for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 86400000) days.push(new Date(t).toISOString().slice(0, 10));
        if (days.length > 62) fail('Maksimal 62 hari sekali ekspor');
        const rows = [];
        for (const d of days) rows.push(...(await this.dayVisits(d)));
        return { csv: toCsv(rows, this.cfg) };
      }
      case 'tables': {
        if (!admin) fail('Mengatur meja hanya bisa dengan PIN admin', 403);
        const t = body.table || {};
        const id = clean(t.id, 8).toUpperCase().replace(/\s+/g, '');
        if (body.op === 'remove') {
          const m = await this.s.get(`t/${id}.json`);
          const v = m?.data?.visit && (await this.readVisit(m.data.visit));
          if (v && !v.data.leftAt) fail(`Meja ${id} sedang terisi tamu. Pulangkan tamu dulu.`, 409);
        }
        const next = await this.saveCfg((c) => {
          let list = structuredClone(tableList(c));
          if (body.op === 'add') {
            if (!/^[A-Z0-9-]{1,6}$/.test(id)) fail('Kode meja 1 sampai 6 huruf/angka, mis. PR7');
            if (list.some((x) => x.id === id)) fail(`Kode meja ${id} sudah dipakai`);
            if (list.length >= 200) fail('Maksimal 200 meja');
            list.push(normTable({ ...t, id }));
          } else if (body.op === 'update') {
            const j = list.findIndex((x) => x.id === id);
            if (j < 0) fail('Meja tidak ditemukan. Muat ulang denah.', 404);
            const p = {};
            for (const k of ['area', 'seats', 'x', 'y', 'gazebo']) if (t[k] !== undefined) p[k] = t[k];
            list[j] = normTable({ ...list[j], ...p, id });
          } else if (body.op === 'remove') {
            if (!list.some((x) => x.id === id)) fail('Meja tidak ditemukan. Muat ulang denah.', 404);
            list = list.filter((x) => x.id !== id);
            if (!list.length) fail('Minimal harus ada satu meja');
          } else fail('Perintah tidak dikenal');
          c.tables = list;
          return c;
        });
        return { cfg: publicCfg(next) };
      }
      case 'config': {
        if (!admin) fail('Pengaturan hanya bisa dengan PIN admin', 403);
        const ps = body.pinStaff ? String(body.pinStaff) : '', pa = body.pinAdmin ? String(body.pinAdmin) : '';
        if (ps && !validPin(ps)) fail('PIN staf harus 4 sampai 8 angka');
        if (pa && !validPin(pa)) fail('PIN admin harus 4 sampai 8 angka');
        const cur = await this.loadCfg(true);
        if ((ps && pa && ps === pa) || (ps && !pa && (await pinOk(ps, cur.pinAdmin))) || (pa && !ps && (await pinOk(pa, cur.pinStaff)))) fail('PIN staf dan PIN admin harus berbeda');
        const hs = ps ? await hashPin(ps) : null, ha = pa ? await hashPin(pa) : null;
        const next = await this.saveCfg((c) => {
          if (Array.isArray(body.staff)) c.staff = [...new Set(body.staff.map((x) => clean(x, 40)).filter(Boolean))].slice(0, 60);
          if (body.pollSec != null) c.pollSec = [15, 20, 30, 60].includes(Number(body.pollSec)) ? Number(body.pollSec) : 30;
          if (body.longMin != null) c.longMin = Math.min(600, Math.max(30, Math.round(Number(body.longMin) || 120)));
          if (hs) c.pinStaff = hs;
          if (ha) c.pinAdmin = ha;
          if (body.logoutAll) c.tokenVer = (c.tokenVer || 1) + 1;
          return c;
        });
        return { cfg: publicCfg(next), token: body.logoutAll ? makeToken(next, 'admin') : undefined };
      }
    }
    fail('Perintah tidak dikenal', 404);
  }
}
