// Kaly Denah Service — API buku tamu meja (Netlify Function + Netlify Blobs)
// Semua data di store "kaly-denah":
//   config            pengaturan, hash PIN, rahasia token
//   v/<tgl>/<id>      satu kunjungan (datang, pulang, catatan). <tgl> = tanggal datang (WIB)
//   t/<meja>          penanda meja sedang terisi → mencegah dua perangkat mengisi meja yang sama
//   snap/<tgl>        salinan riwayat satu hari (untuk riwayat & ekspor yang cepat)
//   lock/<ip>         hitungan salah PIN (anti tebak PIN)
import { getStore } from '@netlify/blobs';
import { scryptSync, randomBytes, createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { TABLES } from '../public/tables.js';

// Daftar meja: hasil ubahan admin (config.tables) atau daftar bawaan di public/tables.js
const tableList = (cfg) => (Array.isArray(cfg?.tables) && cfg.tables.length ? cfg.tables : TABLES);
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const normTable = (t) => ({ id: t.id, area: clean(t.area, 40) || 'Lainnya', seats: Math.min(40, Math.max(1, Math.round(num(t.seats, 4)))),
  x: Math.round(Math.min(99, Math.max(1, num(t.x, 50))) * 100) / 100, y: Math.round(Math.min(99, Math.max(1, num(t.y, 50))) * 100) / 100, ...(t.gazebo ? { gazebo: true } : {}) });
const WIB = 7 * 3600 * 1000;
const day = (ms = Date.now()) => new Date(ms + WIB).toISOString().slice(0, 10);
const store = () => getStore({ name: 'kaly-denah', consistency: 'strong' });

// ---------- Respons ----------
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
class Fail extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }
const fail = (msg, status) => { throw new Fail(msg, status); };

// ---------- PIN & token ----------
const hashPin = (pin, salt = randomBytes(16).toString('hex')) => ({ salt, hash: scryptSync(String(pin), salt, 32).toString('hex') });
const pinOk = (pin, h) => { if (!h) return false; const a = scryptSync(String(pin), h.salt, 32), b = Buffer.from(h.hash, 'hex'); return a.length === b.length && timingSafeEqual(a, b); };
const validPin = (p) => /^\d{4,8}$/.test(String(p || ''));
const b64 = (s) => Buffer.from(s).toString('base64url');
const sign = (cfg, body) => createHmac('sha256', cfg.secret).update(body).digest('base64url');
function makeToken(cfg, role) {
  const body = b64(JSON.stringify({ r: role, v: cfg.tokenVer, e: Date.now() + 90 * 86400000 }));
  return body + '.' + sign(cfg, body);
}
function readToken(cfg, req) {
  const t = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const [body, sig] = t.split('.');
  if (!body || !sig) return null;
  const good = sign(cfg, body);
  if (good.length !== sig.length || !timingSafeEqual(Buffer.from(good), Buffer.from(sig))) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.v === cfg.tokenVer && p.e > Date.now() ? p.r : null; } catch { return null; }
}

// ---------- Data ----------
async function getConfig(s) { return s.get('config', { type: 'json' }); }
const clean = (x, n = 200) => String(x ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const publicCfg = (c) => ({ staff: c.staff || [], pollSec: c.pollSec || 30, longMin: c.longMin || 120, tables: Array.isArray(c.tables) && c.tables.length ? c.tables : null });

async function readVisit(s, key) {
  const r = await s.getWithMetadata(key, { type: 'json' });
  return r ? { data: r.data, etag: r.etag } : null;
}
// Ubah satu kunjungan dengan aman walau dua perangkat menyimpan bersamaan (tulis bersyarat + ulangi)
async function updateVisit(s, key, fn) {
  for (let i = 0; i < 6; i++) {
    const cur = await readVisit(s, key);
    if (!cur) fail('Data kunjungan tidak ditemukan. Muat ulang halaman.', 404);
    const next = fn(structuredClone(cur.data));
    if (!next) return cur;
    next.updatedAt = Date.now();
    const r = await s.setJSON(key, next, { onlyIfMatch: cur.etag });
    if (r.modified) return { data: next, etag: r.etag };
  }
  fail('Data sedang diubah dari perangkat lain. Coba lagi.', 409);
}
// Kunci meja: penanda t/<meja> hanya bisa dibuat kalau meja kosong
async function lockTables(s, ids, key) {
  const done = [];
  for (const id of ids) {
    const mk = 't/' + id;
    let r = await s.setJSON(mk, { visit: key, at: Date.now() }, { onlyIfNew: true });
    if (!r.modified) {
      // Penanda lama yang kunjungannya sudah pulang/terhapus boleh ditimpa
      const m = await s.getWithMetadata(mk, { type: 'json' });
      const v = m?.data?.visit && (await readVisit(s, m.data.visit));
      if (m && (!v || v.data.leftAt)) r = await s.setJSON(mk, { visit: key, at: Date.now() }, { onlyIfMatch: m.etag });
    }
    if (!r.modified) { await unlockTables(s, done, key); fail(`Meja ${id} sedang terisi. Muat ulang denah.`, 409); }
    done.push(id);
  }
}
async function unlockTables(s, ids, key) {
  await Promise.all(ids.map(async (id) => {
    const m = await s.getWithMetadata('t/' + id, { type: 'json' });
    if (m && m.data?.visit === key) await s.delete('t/' + id);
  }));
}
const tablesOf = (v) => [v.table, ...(v.join || [])];
function checkTables(cfg, table, join) {
  const ids = [table, ...(join || [])].map((x) => clean(x, 8).toUpperCase());
  const known = new Set(tableList(cfg).map((t) => t.id));
  if (!ids.every((x) => known.has(x))) fail('Meja tidak dikenal');
  if (new Set(ids).size !== ids.length) fail('Meja dobel');
  return ids;
}
const timeOk = (ms, now = Date.now()) => Number.isFinite(ms) && ms > now - 36 * 3600000 && ms < now + 10 * 60000;

// Semua kunjungan satu tanggal. Hari yang sudah lewat disalin ke snap/<tgl> supaya riwayat & ekspor cepat.
async function dayVisits(s, d) {
  const { blobs } = await s.list({ prefix: `v/${d}/` });
  const sig = createHash('sha1').update(blobs.map((b) => b.key + b.etag).sort().join('|')).digest('hex');
  const past = d < day();
  if (past) {
    const snap = await s.get('snap/' + d, { type: 'json' });
    if (snap && snap.sig === sig) return snap.visits;
  }
  const visits = (await Promise.all(blobs.map((b) => s.get(b.key, { type: 'json' })))).filter(Boolean);
  visits.sort((a, b) => a.arriveAt - b.arriveAt);
  if (past) await s.setJSON('snap/' + d, { sig, visits });
  return visits;
}

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

// ---------- Rute ----------
async function handle(req, context) {
  const s = store();
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, '');
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const cfg = await getConfig(s);

  if (path === 'hello') return json({ setup: !!cfg, now: Date.now(), today: day() });

  if (path === 'setup') {
    if (cfg) fail('Aplikasi sudah disiapkan. Masuk dengan PIN.', 403);
    if (!validPin(body.pinStaff) || !validPin(body.pinAdmin)) fail('PIN harus 4 sampai 8 angka');
    if (String(body.pinStaff) === String(body.pinAdmin)) fail('PIN staf dan PIN admin harus berbeda');
    const staff = [...new Set((body.staff || []).map((x) => clean(x, 40)).filter(Boolean))].slice(0, 60);
    const c = { v: 1, pinStaff: hashPin(body.pinStaff), pinAdmin: hashPin(body.pinAdmin), secret: randomBytes(32).toString('hex'), tokenVer: 1, staff, pollSec: 30, longMin: 120, createdAt: Date.now() };
    const r = await s.setJSON('config', c, { onlyIfNew: true });
    if (!r.modified) fail('Aplikasi sudah disiapkan dari perangkat lain. Masuk dengan PIN.', 409);
    return json({ token: makeToken(c, 'admin'), role: 'admin', cfg: publicCfg(c) });
  }
  if (!cfg) fail('Aplikasi belum disiapkan', 428);

  if (path === 'login') {
    const ip = createHash('sha1').update(String(context?.ip || 'x')).digest('hex').slice(0, 16);
    const lk = await s.get('lock/' + ip, { type: 'json' });
    if (lk && lk.until > Date.now()) fail(`Terlalu banyak PIN salah. Coba lagi ${Math.ceil((lk.until - Date.now()) / 60000)} menit lagi.`, 429);
    const pin = String(body.pin || '');
    // PIN darurat bila PIN admin lupa: isi environment variable DENAH_ADMIN_PIN di Netlify lalu unggah ulang
    const emergency = String(globalThis.Netlify?.env?.get?.('DENAH_ADMIN_PIN') ?? process.env.DENAH_ADMIN_PIN ?? '');
    const role = pinOk(pin, cfg.pinAdmin) || (validPin(emergency) && pin.length === emergency.length && timingSafeEqual(Buffer.from(pin), Buffer.from(emergency))) ? 'admin' : pinOk(pin, cfg.pinStaff) ? 'staff' : null;
    if (!role) {
      const fails = (lk && Date.now() - lk.at < 15 * 60000 ? lk.fails : 0) + 1;
      await s.setJSON('lock/' + ip, { fails, at: Date.now(), until: fails >= 5 ? Date.now() + 10 * 60000 : 0 });
      fail(fails >= 5 ? 'PIN salah 5 kali. Tunggu 10 menit.' : 'PIN salah', 401);
    }
    if (lk) await s.delete('lock/' + ip);
    return json({ token: makeToken(cfg, role), role, cfg: publicCfg(cfg) });
  }

  const role = readToken(cfg, req);
  if (!role) fail('Sesi habis. Masuk lagi dengan PIN.', 401);
  const admin = role === 'admin';
  const by = clean(body.by, 40);

  switch (path) {
    case 'me': return json({ role, cfg: publicCfg(cfg), now: Date.now(), today: day() });

    // Sinkron: kunjungan hari ini & kemarin. Perangkat mengirim etag yang sudah dimilikinya, server hanya mengirim yang berubah.
    case 'sync': {
      const known = body.known && typeof body.known === 'object' ? body.known : {};
      const days = [day(), day(Date.now() - 86400000)];
      const lists = await Promise.all(days.map((d) => s.list({ prefix: `v/${d}/` })));
      const blobs = lists.flatMap((l) => l.blobs);
      const changed = {};
      await Promise.all(blobs.filter((b) => known[b.key] !== b.etag).map(async (b) => {
        const data = await s.get(b.key, { type: 'json' });
        if (data) changed[b.key] = { data, etag: b.etag };
      }));
      return json({ now: Date.now(), today: days[0], keys: blobs.map((b) => b.key), changed, cfg: publicCfg(cfg), role });
    }

    case 'arrive': {
      const ids = checkTables(cfg, body.table, body.join);
      const pax = Math.round(Number(body.pax));
      if (!(pax >= 1 && pax <= 200)) fail('Jumlah tamu 1 sampai 200');
      const at = body.at ? Number(body.at) : Date.now();
      if (!timeOk(at)) fail('Jam datang tidak valid');
      const d = day(at);
      const id = Date.now().toString(36) + randomBytes(3).toString('hex');
      const key = `v/${d}/${id}`;
      await lockTables(s, ids, key);
      const v = { id, key, day: d, table: ids[0], join: ids.slice(1), pax, name: clean(body.name, 80), arriveAt: at, arriveBy: by, leftAt: null, leftBy: '',
        notes: clean(body.note, 300) ? [{ at: Date.now(), by, text: clean(body.note, 300) }] : [], createdAt: Date.now(), updatedAt: Date.now() };
      const r = await s.setJSON(key, v, { onlyIfNew: true });
      return json({ key, etag: r.etag, data: v });
    }

    case 'note': {
      const text = clean(body.text, 300);
      if (!text) fail('Catatan masih kosong');
      const r = await updateVisit(s, body.key, (v) => { v.notes = [...(v.notes || []), { at: Date.now(), by, text }].slice(-50); return v; });
      return json({ key: body.key, ...r });
    }

    case 'note-del': {
      const r = await updateVisit(s, body.key, (v) => { v.notes = (v.notes || []).filter((n) => n.at !== Number(body.at)); return v; });
      return json({ key: body.key, ...r });
    }

    case 'edit': {
      const p = body.patch || {};
      const r = await updateVisit(s, body.key, (v) => {
        if (v.leftAt && !admin && v.day < day()) fail('Kunjungan hari sebelumnya hanya bisa diubah admin', 403);
        if (p.pax != null) { const n = Math.round(Number(p.pax)); if (!(n >= 1 && n <= 200)) fail('Jumlah tamu 1 sampai 200'); v.pax = n; }
        if (p.name != null) v.name = clean(p.name, 80);
        if (p.arriveAt != null) { const t = Number(p.arriveAt); if (!timeOk(t) && !admin) fail('Jam datang tidak valid'); if (v.leftAt && t > v.leftAt) fail('Jam datang harus sebelum jam pulang'); v.arriveAt = t; }
        if (p.leftAt != null && v.leftAt) { const t = Number(p.leftAt); if (t < v.arriveAt) fail('Jam pulang harus sesudah jam datang'); v.leftAt = t; }
        return v;
      });
      return json({ key: body.key, ...r });
    }

    case 'move': {
      const cur = await readVisit(s, body.key);
      if (!cur || cur.data.leftAt) fail('Tamu ini sudah pulang', 409);
      const ids = checkTables(cfg, body.table, body.join);
      const old = tablesOf(cur.data);
      const add = ids.filter((x) => !old.includes(x)), drop = old.filter((x) => !ids.includes(x));
      await lockTables(s, add, body.key);
      const r = await updateVisit(s, body.key, (v) => { v.table = ids[0]; v.join = ids.slice(1); return v; });
      await unlockTables(s, drop, body.key);
      return json({ key: body.key, ...r });
    }

    case 'leave': {
      const at = body.at ? Number(body.at) : Date.now();
      const note = clean(body.note, 300);
      const r = await updateVisit(s, body.key, (v) => {
        if (v.leftAt) return null;
        if (!(at >= v.arriveAt - 60000) || at > Date.now() + 10 * 60000) fail('Jam pulang harus sesudah jam datang');
        v.leftAt = Math.max(at, v.arriveAt); v.leftBy = by;
        if (note) v.notes = [...(v.notes || []), { at: Date.now(), by, text: note }];
        return v;
      });
      await unlockTables(s, tablesOf(r.data), body.key);
      return json({ key: body.key, ...r });
    }

    // Batalkan "tamu pulang" yang salah tekan (meja harus masih kosong)
    case 'reopen': {
      const cur = await readVisit(s, body.key);
      if (!cur || !cur.data.leftAt) fail('Kunjungan ini belum pulang');
      if (!admin && Date.now() - cur.data.leftAt > 3 * 3600000) fail('Hanya bisa dibatalkan dalam 3 jam. Minta admin.', 403);
      await lockTables(s, tablesOf(cur.data), body.key);
      const r = await updateVisit(s, body.key, (v) => { v.leftAt = null; v.leftBy = ''; return v; });
      return json({ key: body.key, ...r });
    }

    case 'delete': {
      if (!admin) fail('Menghapus data hanya bisa dengan PIN admin', 403);
      const cur = await readVisit(s, body.key);
      if (cur) { await unlockTables(s, tablesOf(cur.data), body.key); await s.delete(body.key); }
      return json({ key: body.key, deleted: true });
    }

    case 'day': {
      const d = String(url.searchParams.get('d') || body.d || day());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) fail('Tanggal tidak valid');
      return json({ day: d, visits: await dayVisits(s, d) });
    }

    case 'export': {
      const from = String(url.searchParams.get('from') || ''), to = String(url.searchParams.get('to') || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) fail('Rentang tanggal tidak valid');
      const days = [];
      for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 86400000) days.push(new Date(t).toISOString().slice(0, 10));
      if (days.length > 62) fail('Maksimal 62 hari sekali ekspor');
      const rows = (await Promise.all(days.map((d) => dayVisits(s, d)))).flat();
      return new Response(toCsv(rows, cfg), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="tamu-kaly-${from}_${to}.csv"`, 'cache-control': 'no-store' } });
    }

    // Atur meja (PIN admin): tambah, ubah (area, kursi, gazebo, posisi), hapus
    case 'tables': {
      if (!admin) fail('Mengatur meja hanya bisa dengan PIN admin', 403);
      const t = body.table || {};
      const id = clean(t.id, 8).toUpperCase().replace(/\s+/g, '');
      for (let i = 0; i < 6; i++) {
        const cur = await s.getWithMetadata('config', { type: 'json' });
        let list = structuredClone(tableList(cur.data));
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
          const m = await s.get('t/' + id, { type: 'json' });
          const v = m?.visit && (await readVisit(s, m.visit));
          if (v && !v.data.leftAt) fail(`Meja ${id} sedang terisi tamu. Pulangkan tamu dulu.`, 409);
          list = list.filter((x) => x.id !== id);
          if (!list.length) fail('Minimal harus ada satu meja');
        } else fail('Perintah tidak dikenal');
        const next = { ...cur.data, tables: list };
        const r = await s.setJSON('config', next, { onlyIfMatch: cur.etag });
        if (r.modified) return json({ cfg: publicCfg(next) });
      }
      fail('Pengaturan sedang diubah dari perangkat lain. Coba lagi.', 409);
    }

    case 'config': {
      if (!admin) fail('Pengaturan hanya bisa dengan PIN admin', 403);
      const c = { ...cfg };
      if (Array.isArray(body.staff)) c.staff = [...new Set(body.staff.map((x) => clean(x, 40)).filter(Boolean))].slice(0, 60);
      if (body.pollSec != null) c.pollSec = [10, 15, 20, 30, 60].includes(Number(body.pollSec)) ? Number(body.pollSec) : 30;
      if (body.longMin != null) c.longMin = Math.min(600, Math.max(30, Math.round(Number(body.longMin) || 120)));
      const ps = body.pinStaff ? String(body.pinStaff) : '', pa = body.pinAdmin ? String(body.pinAdmin) : '';
      if (ps && !validPin(ps)) fail('PIN staf harus 4 sampai 8 angka');
      if (pa && !validPin(pa)) fail('PIN admin harus 4 sampai 8 angka');
      if ((ps && pa && ps === pa) || (ps && !pa && pinOk(ps, cfg.pinAdmin)) || (pa && !ps && pinOk(pa, cfg.pinStaff))) fail('PIN staf dan PIN admin harus berbeda');
      if (ps) c.pinStaff = hashPin(ps);
      if (pa) c.pinAdmin = hashPin(pa);
      if (body.logoutAll) c.tokenVer = (c.tokenVer || 1) + 1;
      await s.setJSON('config', c);
      return json({ cfg: publicCfg(c), token: body.logoutAll ? makeToken(c, 'admin') : undefined });
    }
  }
  fail('Alamat tidak dikenal', 404);
}

export default async (req, context) => {
  try { return await handle(req, context); }
  catch (e) {
    if (e instanceof Fail) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Server sedang bermasalah. Coba lagi sebentar.' }, 500);
  }
};

export const config = { path: '/api/*' };
