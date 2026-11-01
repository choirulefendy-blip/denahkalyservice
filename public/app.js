// Kaly Denah Service — buku tamu meja untuk service/pramusaji.
// Data disimpan di Netlify Blobs lewat fungsi /api/* (lihat netlify/functions/api.mjs). Tiap perangkat sinkron berkala.
import { TABLES as BASE_TABLES, AREAS as BASE_AREAS, IMG } from './tables.js';
import { ICONS } from './icons.js';

// ---------- Utilitas ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ic = (n, s = 18) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;
const WIB = 7 * 3600000;
const TF = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false });
const DF = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const tm = (ms) => (ms ? TF.format(ms).replace(':', '.') : '—');
const dayOf = (ms) => new Date(ms + WIB).toISOString().slice(0, 10);
const dur = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m < 60 ? `${m} mnt` : `${Math.floor(m / 60)} j ${m % 60} mnt`; };
// Daftar meja aktif: hasil Atur meja (dari server) atau daftar bawaan
let TABLES = BASE_TABLES, AREAS = BASE_AREAS, T = {};
function useTables(list) {
  TABLES = Array.isArray(list) && list.length ? list : BASE_TABLES;
  T = Object.fromEntries(TABLES.map((t) => [t.id, t]));
  AREAS = [...BASE_AREAS.filter((a) => TABLES.some((t) => t.area === a)), ...new Set(TABLES.map((t) => t.area).filter((a) => !BASE_AREAS.includes(a)))];
}
const LS = { get: (k, d = null) => { try { const v = localStorage.getItem('kd.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { v == null ? localStorage.removeItem('kd.' + k) : localStorage.setItem('kd.' + k, JSON.stringify(v)); } catch {} } };
const NOTE_TAGS = ['Ulang tahun', 'Kursi bayi', 'Alergi', 'Tamu VIP', 'Reservasi', 'Rombongan', 'Minta tagihan', 'Komplain'];

// ---------- Keadaan ----------
const S = {
  token: LS.get('token'), role: LS.get('role'), cfg: LS.get('cfg', { staff: [], pollSec: 30, longMin: 120 }), me: LS.get('me', ''),
  visits: new Map(), skew: 0, view: 'denah', sel: null, area: 'all', filter: 'all', zoom: LS.get('zoom', 0),
  form: {}, hist: { d: null, visits: null, q: '', area: 'all' }, sync: 'wait', lastSync: 0, screen: 'boot', busy: false,
};
useTables(S.cfg.tables);
const now = () => Date.now() + S.skew;
const today = () => dayOf(now());

// ---------- API ----------
async function api(path, body) {
  let r;
  try {
    r = await fetch('/api/' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(S.token ? { authorization: 'Bearer ' + S.token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  } catch { setSync('off'); throw new Error('Tidak tersambung ke internet. Cek koneksi, lalu coba lagi.'); }
  const data = (r.headers.get('content-type') || '').includes('json') ? await r.json().catch(() => ({})) : await r.text();
  if (r.status === 401 && S.token && path !== 'login') { logout('Sesi habis. Masuk lagi dengan PIN.'); }
  if (r.status === 404 && typeof data === 'string') throw new Error('Server denah belum aktif. Pastikan folder diunggah lengkap ke Netlify (termasuk folder netlify).');
  if (!r.ok) throw new Error(data?.error || 'Terjadi kesalahan (' + r.status + ')');
  return data;
}
const by = () => S.me || '';
function setCfg(c) { S.cfg = c; LS.set('cfg', c); useTables(c.tables); if (S.sel && !T[S.sel]) S.sel = null; }
function put(res) { if (res?.key && res.data) S.visits.set(res.key, { data: res.data, etag: res.etag }); if (res?.deleted) S.visits.delete(res.key); }

// ---------- Sinkron ----------
let syncT = null, syncing = false;
function setSync(s) { S.sync = s; const el = $('#sync'); if (el) { el.className = 'sync ' + s; el.innerHTML = `<i></i>${s === 'ok' ? 'Tersinkron' : s === 'off' ? 'Offline' : 'Memuat…'}`; } }
async function sync(force) {
  if (!S.token || syncing) return;
  syncing = true;
  try {
    const known = {}; for (const [k, v] of S.visits) known[k] = v.etag;
    const t0 = Date.now();
    const r = await api('sync', { known });
    S.skew = r.now - Math.round((t0 + Date.now()) / 2);
    const keep = new Set(r.keys);
    for (const k of [...S.visits.keys()]) if (!keep.has(k)) S.visits.delete(k);
    for (const [k, v] of Object.entries(r.changed)) S.visits.set(k, v);
    if (JSON.stringify(r.cfg) !== JSON.stringify(S.cfg)) { setCfg(r.cfg); force = true; }
    if (r.role !== S.role) { S.role = r.role; LS.set('role', r.role); if (r.role !== 'admin') S.edit = false; }
    S.lastSync = Date.now(); setSync('ok');
    if (Object.keys(r.changed).length || force || r.keys.length !== Object.keys(known).length) refresh();
    else updateLive();
  } catch (e) { if (S.token) setSync('off'); }
  finally { syncing = false; schedule(); }
}
// Hemat kuota Netlify: perangkat yang tidak disentuh lebih dari 5 menit memperbarui tiap 60 detik,
// dan langsung memperbarui lagi saat disentuh.
let lastAct = Date.now();
const IDLE = 5 * 60000;
['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => { const was = Date.now() - lastAct > IDLE; lastAct = Date.now(); if (was && S.token && S.screen === 'main') sync(); }, { capture: true, passive: true }));
function schedule() {
  clearTimeout(syncT);
  if (!S.token || document.hidden) return;
  const base = S.cfg.pollSec || 30;
  syncT = setTimeout(sync, (S.sync === 'off' ? 15 : Date.now() - lastAct > IDLE ? Math.max(60, base) : base) * 1000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.token) sync(); else clearTimeout(syncT); });
window.addEventListener('online', () => S.token && sync());

// ---------- Data turunan ----------
const openVisits = () => [...S.visits.values()].map((v) => v.data).filter((v) => !v.leftAt && now() - v.arriveAt < 20 * 3600000);
function occupancy() {
  const m = {};
  for (const v of openVisits()) for (const id of [v.table, ...(v.join || [])]) if (!m[id] || m[id].arriveAt > v.arriveAt) m[id] = v;
  return m;
}
const isLong = (v) => now() - v.arriveAt > (S.cfg.longMin || 120) * 60000;
const tablesOf = (v) => [v.table, ...(v.join || [])];

// ---------- Tampilan umum ----------
function toast(msg, kind = 'ok', opts = {}) {
  const el = document.createElement('div');
  el.className = 'toast t-' + kind;
  el.innerHTML = `${ic(kind === 'err' ? 'circle-alert' : kind === 'warn' ? 'triangle-alert' : 'circle-check', 18)}<span>${esc(msg)}</span>${opts.action ? `<button class="toast-act">${esc(opts.action)}</button>` : ''}`;
  if (opts.action) el.querySelector('.toast-act').onclick = () => { el.remove(); opts.onAction(); };
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, opts.ms || (opts.action ? 9000 : 3200));
}
function modal(title, body, { ok = 'Simpan', danger = false, onOk, wide = false } = {}) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-h"><h3>${esc(title)}</h3><button class="icon-btn" data-x aria-label="Tutup">${ic('x')}</button></div>
    <div class="modal-b">${body}</div><div class="modal-f"><button class="btn" data-x>${onOk ? 'Batal' : 'Tutup'}</button>${onOk ? `<button class="btn ${danger ? 'btn-danger' : 'btn-pri'}" data-ok>${esc(ok)}</button>` : ''}</div></div>`;
  const close = () => { back.remove(); document.removeEventListener('keydown', key); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  back.addEventListener('click', async (e) => {
    if (e.target === back || e.target.closest('[data-x]')) return close();
    const b = e.target.closest('[data-ok]');
    if (b && onOk) { b.disabled = true; try { if ((await onOk(back)) !== false) close(); } catch (err) { toast(err.message, 'err'); } finally { b.disabled = false; } }
  });
  document.body.appendChild(back);
  setTimeout(() => back.querySelector('input,select,textarea')?.focus(), 30);
  return back;
}
const logo = (v = 'olive') => `<img class="logo" src="assets/kaly-logo-${v}.svg" alt="kaly">`;

// ---------- Layar: siapkan, masuk, pilih petugas ----------
function setupView() {
  return `<div class="gate"><div class="gate-card wide">${logo()}<h1>Siapkan Denah Service</h1>
    <p class="muted">Dilakukan sekali oleh Owner/manajer. Buat dua PIN angka: <b>PIN staf</b> untuk tablet/HP service sehari-hari, dan <b>PIN admin</b> untuk pengaturan, koreksi, dan hapus data.</p>
    <form id="setup" class="grid2" autocomplete="off">
      <label class="fld"><span>PIN staf (4–8 angka)</span><input name="ps" type="password" inputmode="numeric" maxlength="8" required></label>
      <label class="fld"><span>Ulangi PIN staf</span><input name="ps2" type="password" inputmode="numeric" maxlength="8" required></label>
      <label class="fld"><span>PIN admin (4–8 angka)</span><input name="pa" type="password" inputmode="numeric" maxlength="8" required></label>
      <label class="fld"><span>Ulangi PIN admin</span><input name="pa2" type="password" inputmode="numeric" maxlength="8" required></label>
      <label class="fld full"><span>Nama petugas service (satu per baris, bisa ditambah nanti)</span><textarea name="staff" rows="4" placeholder="Contoh:&#10;Wulan&#10;Agus"></textarea></label>
      <button class="btn btn-pri btn-lg full">Simpan & mulai</button></form></div></div>`;
}
function loginView(msg) {
  return `<div class="gate"><div class="gate-card">${logo()}<h1>Denah Service</h1><p class="muted">Masukkan PIN untuk membuka denah.</p>
    ${msg ? `<p class="gate-msg">${esc(msg)}</p>` : ''}
    <div class="pin-dots" id="pin-dots">${'<i></i>'.repeat(4)}</div>
    <input id="pin-in" class="pin-in" type="password" inputmode="none" maxlength="8" autocomplete="current-password" aria-label="PIN" tabindex="-1">
    <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}">${n}</button>`).join('')}<button data-k="del" aria-label="Hapus">${ic('chevron-left', 22)}</button><button data-k="0">0</button><button data-k="ok" class="kp-ok" aria-label="Masuk">${ic('check', 24)}</button></div></div></div>`;
}
function whoView() {
  const st = S.cfg.staff || [];
  return `<div class="gate"><div class="gate-card">${logo()}<h1>Siapa yang bertugas?</h1><p class="muted">Nama ini tercatat di setiap tamu datang, pulang, dan catatan dari perangkat ini.</p>
    <div class="who-list">${st.map((n) => `<button class="chip lg ${S.me === n ? 'on' : ''}" data-who="${esc(n)}">${ic('user', 16)} ${esc(n)}</button>`).join('')}</div>
    <form id="who-other" class="row"><input name="n" placeholder="Nama lain" maxlength="40" value="${st.includes(S.me) ? '' : esc(S.me)}"><button class="btn btn-pri">Lanjut</button></form></div></div>`;
}

// ---------- Layar utama ----------
function shell() {
  const tabs = [['denah', 'map', 'Denah'], ['riwayat', 'history', 'Riwayat'], ...(S.role === 'admin' ? [['atur', 'settings', 'Pengaturan']] : [])];
  return `<header class="top">${logo('offwhite')}<span class="top-t">Denah Service</span>
    <nav class="tabs">${tabs.map(([k, i, l]) => `<button class="tab ${S.view === k ? 'on' : ''}" data-view="${k}">${ic(i, 17)}<span>${l}</span></button>`).join('')}</nav>
    <div class="top-r"><span class="sync ${S.sync}" id="sync"></span><button class="chip who" data-act="who" title="Ganti petugas">${ic('user', 15)} ${esc(S.me || 'Petugas')}</button><span class="clock" id="clock"></span>
      <button class="icon-btn light" data-act="logout" aria-label="Keluar" title="Keluar">${ic('log-out', 18)}</button></div></header>
    <main id="main">${S.view === 'denah' ? denahView() : S.view === 'riwayat' ? histView() : setView()}</main>`;
}

// Denah
function pinHtml(t, v) {
  const st = v ? (isLong(v) ? 'long' : 'busy') : 'free';
  const dim = S.filter !== 'all' && S.filter !== st && !(S.filter === 'busy' && st === 'long');
  return `<button class="pin st-${st}${t.gazebo ? ' gz' : ''}${S.sel === t.id ? ' sel' : ''}${dim ? ' dim' : ''}" style="left:${t.x}%;top:${t.y}%" data-t="${t.id}" aria-label="Meja ${t.id}, ${v ? `terisi ${v.pax} orang` : 'kosong'}">
    <b>${t.id}</b>${v ? (v.table === t.id ? `<small>${v.pax} org</small><small class="t" data-since="${v.arriveAt}"></small>` : `<small>gabung</small><small class="t">${esc(v.table)}</small>`) : `<small>${t.seats} kursi</small>`}</button>`;
}
function statsHtml(occ) {
  const open = openVisits();
  const busy = TABLES.filter((t) => occ[t.id]).length, long = TABLES.filter((t) => occ[t.id] && isLong(occ[t.id])).length;
  const pax = open.reduce((s, v) => s + v.pax, 0);
  const b = (k, l, n) => `<button class="stat st-${k} ${S.filter === k ? 'on' : ''}" data-filter="${k}"><i></i>${l}<b>${n}</b></button>`;
  return `${b('all', 'Semua meja', TABLES.length)}${b('free', 'Kosong', TABLES.length - busy)}${b('busy', 'Terisi', busy)}${b('long', `Duduk > ${Math.round((S.cfg.longMin || 120) / 60 * 10) / 10} jam`, long)}<span class="stat-pax">${ic('users', 17)} <b>${pax}</b> tamu sedang duduk</span>`;
}
function denahView() {
  const occ = occupancy();
  return `<div class="dn"><div class="dn-bar"><div class="stats" id="stats">${statsHtml(occ)}</div>
      <div class="dn-tools"><label class="selw">${ic('map-pin', 16)}<select id="area" aria-label="Lompat ke area"><option value="all">Semua area</option>${AREAS.map((a) => `<option ${S.area === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></label>
      <div class="seg"><button data-zoom="out" aria-label="Perkecil">${ic('zoom-out', 17)}</button><button data-zoom="fit" aria-label="Seluruh denah">${ic('maximize', 16)}</button><button data-zoom="in" aria-label="Perbesar">${ic('zoom-in', 17)}</button></div>
      ${S.role === 'admin' && !S.edit ? `<button class="btn btn-sm" data-act="edit-on">${ic('move', 16)} Atur meja</button>` : ''}</div></div>
    ${S.edit ? `<div class="edit-bar">${ic('move', 18)}<span><b>Atur meja</b> · Ketuk tempat kosong di denah untuk <b>menambah meja</b>. Seret meja untuk memindahkan, ketuk meja untuk ubah atau hapus.</span><button class="btn btn-sm" data-act="t-add">${ic('plus', 16)} Tambah meja</button><button class="btn btn-sm btn-pri" data-act="edit-off">${ic('check', 16)} Selesai</button></div>` : ''}
    <div class="dn-body"><div class="map-wrap" id="map-wrap"><div class="map${S.edit ? ' editing' : ''}" id="map"><img src="assets/denah.png" alt="Denah Kaly Eatery" width="${IMG.w}" height="${IMG.h}" draggable="false"><div id="pins">${TABLES.map((t) => pinHtml(t, occ[t.id])).join('')}</div></div></div>
      <aside class="panel" id="panel">${panelHtml(occ)}</aside></div>
    <div class="legend"><span><i class="lg st-free"></i>Kosong</span><span><i class="lg st-busy"></i>Terisi</span><span><i class="lg st-long"></i>Duduk lama</span><span><i class="lg gz"></i>Gazebo</span><span class="muted">Angka = jumlah tamu · lama duduk. Ketuk meja untuk mencatat.</span></div></div>`;
}
function panelHtml(occ) {
  const t = S.sel && T[S.sel];
  if (!t) return overviewHtml(occ);
  const v = occ[t.id];
  return `<div class="p-h"><div><h3>Meja ${esc(v ? tablesOf(v).join(' + ') : t.id)}${t.gazebo ? ' <span class="badge gold">Gazebo</span>' : ''}</h3><small class="muted">${esc(t.area)} · ${t.seats} kursi</small></div><button class="icon-btn" data-act="unsel" aria-label="Tutup">${ic('x')}</button></div>${v ? busyHtml(v) : arriveHtml(t, occ)}`;
}
function overviewHtml(occ) {
  const open = openVisits().sort((a, b) => a.arriveAt - b.arriveAt);
  const recent = [...S.visits.values()].map((x) => x.data).filter((v) => v.leftAt && v.day === today()).sort((a, b) => b.leftAt - a.leftAt).slice(0, 6);
  const row = (v) => `<button class="li" data-t="${v.table}"><span><b>Meja ${esc(tablesOf(v).join(' + '))}</b><small>${v.pax} orang${v.name ? ' · ' + esc(v.name) : ''}${(v.notes || []).length ? ' · ' + ic('notebook-pen', 13) + ' ' + v.notes.length : ''}</small></span><span class="li-r ${isLong(v) ? 'warn' : ''}" data-since="${v.arriveAt}"></span></button>`;
  return `<div class="p-h"><div><h3>Sedang duduk</h3><small class="muted">Ketuk meja di denah untuk mencatat tamu datang</small></div></div>
    ${open.length ? `<div class="list">${open.map(row).join('')}</div>` : '<p class="empty">Belum ada tamu. Ketuk meja kosong saat tamu datang.</p>'}
    <h4 class="sec">Baru pulang</h4>${recent.length ? `<div class="list">${recent.map((v) => `<div class="li static"><span><b>Meja ${esc(tablesOf(v).join(' + '))}</b><small>${v.pax} orang · ${tm(v.arriveAt)}–${tm(v.leftAt)} · ${dur(v.leftAt - v.arriveAt)}</small></span><button class="btn btn-sm btn-ghost" data-act="reopen" data-k="${v.key}" title="Salah tekan pulang? Kembalikan">${ic('rotate-ccw', 15)}</button></div>`).join('')}</div>` : '<p class="empty sm">Belum ada.</p>'}`;
}
function arriveHtml(t, occ) {
  const f = S.form.t === t.id ? S.form : (S.form = { t: t.id, pax: Math.min(t.seats, 2), name: '', note: '', time: '', join: [] });
  const near = TABLES.filter((x) => x.area === t.area && x.id !== t.id && !occ[x.id]);
  return `<form id="arrive" class="p-b" autocomplete="off">
    <label class="fld"><span>Jumlah tamu</span><div class="stepper"><button type="button" data-step="-1" aria-label="Kurangi">${ic('minus', 20)}</button><input id="f-pax" name="pax" type="number" inputmode="numeric" min="1" max="200" value="${f.pax}"><button type="button" data-step="1" aria-label="Tambah">${ic('plus', 20)}</button></div></label>
    <div class="chips sm">${[1, 2, 3, 4, 5, 6, 8, 10].map((n) => `<button type="button" class="chip ${Number(f.pax) === n ? 'on' : ''}" data-pax="${n}">${n}</button>`).join('')}</div>
    <label class="fld"><span>Nama / keterangan <em>(opsional)</em></span><input id="f-name" name="name" maxlength="80" placeholder="mis. Bu Rina, rombongan kantor" value="${esc(f.name)}"></label>
    <label class="fld"><span>Catatan <em>(opsional)</em></span><input id="f-note" name="note" maxlength="300" placeholder="mis. minta kursi bayi" value="${esc(f.note)}"></label>
    <div class="chips sm">${NOTE_TAGS.slice(0, 6).map((n) => `<button type="button" class="chip" data-tag="${esc(n)}">${esc(n)}</button>`).join('')}</div>
    ${near.length ? `<details ${f.join.length ? 'open' : ''}><summary>Gabung dengan meja lain (rombongan)</summary><div class="chips sm">${near.map((x) => `<button type="button" class="chip ${f.join.includes(x.id) ? 'on' : ''}" data-join="${x.id}">${x.id}</button>`).join('')}</div></details>` : ''}
    <label class="fld inline"><span>Jam datang</span><input id="f-time" name="time" type="time" value="${esc(f.time || '')}"><small class="muted">kosongkan = sekarang</small></label>
    <button class="btn btn-pri btn-lg btn-block">${ic('users', 19)} Catat tamu datang</button></form>`;
}
function busyHtml(v) {
  const notes = v.notes || [];
  const f = S.form.k === v.key ? S.form : (S.form = { k: v.key, note: '' });
  return `<div class="p-b"><div class="info"><div><small>Tamu</small><b>${v.pax} orang</b></div><div><small>Datang</small><b>${tm(v.arriveAt)}</b></div><div><small>Lama duduk</small><b class="${isLong(v) ? 'warn' : ''}" data-since="${v.arriveAt}"></b></div></div>
    ${v.name ? `<p class="name">${ic('user', 15)} ${esc(v.name)}</p>` : ''}
    <p class="muted sm">Dicatat ${esc(v.arriveBy || '—')} pukul ${tm(v.arriveAt)}</p>
    <h4 class="sec">Catatan ${notes.length ? `<span class="muted">${notes.length}</span>` : ''}</h4>
    ${notes.length ? `<ul class="notes">${notes.map((n) => `<li><span class="n-t">${tm(n.at)}</span><span class="n-x">${esc(n.text)}<small>${esc(n.by || '')}</small></span><button class="icon-btn sm" data-act="note-del" data-k="${v.key}" data-at="${n.at}" aria-label="Hapus catatan">${ic('x', 14)}</button></li>`).join('')}</ul>` : '<p class="empty sm">Belum ada catatan.</p>'}
    <form id="note" class="note-f" data-k="${v.key}"><input id="f-n" name="text" maxlength="300" placeholder="Tulis catatan…" value="${esc(f.note)}"><button class="btn btn-pri" aria-label="Simpan catatan">${ic('plus', 18)}</button></form>
    <div class="chips sm">${NOTE_TAGS.map((n) => `<button type="button" class="chip" data-qnote="${esc(n)}" data-k="${v.key}">${esc(n)}</button>`).join('')}</div>
    <div class="acts"><button class="btn btn-orange btn-lg btn-block" data-act="leave" data-k="${v.key}">${ic('log-out', 19)} Tamu pulang</button>
      <div class="row2"><button class="btn" data-act="edit" data-k="${v.key}">${ic('square-pen', 16)} Ubah</button><button class="btn" data-act="move" data-k="${v.key}">${ic('arrow-left-right', 16)} Pindah / gabung</button></div>
      ${S.role === 'admin' ? `<button class="btn btn-ghost btn-sm danger" data-act="del" data-k="${v.key}">${ic('trash-2', 15)} Hapus data salah input</button>` : ''}</div></div>`;
}

// Riwayat
function histRows() {
  const d = S.hist.d || today();
  let vs = d === today() ? [...S.visits.values()].map((x) => x.data).filter((v) => v.day === d) : S.hist.visits;
  if (!vs) return null;
  vs = [...vs].sort((a, b) => a.arriveAt - b.arriveAt);
  const q = S.hist.q.trim().toLowerCase();
  if (S.hist.area !== 'all') vs = vs.filter((v) => T[v.table]?.area === S.hist.area);
  if (q) vs = vs.filter((v) => [v.table, ...(v.join || []), v.name, v.arriveBy, v.leftBy, ...(v.notes || []).map((n) => n.text)].join(' ').toLowerCase().includes(q));
  return vs;
}
function histView() {
  const d = S.hist.d || today();
  if (d !== today() && S.hist.visits === null && !S.hist.loading) loadHist(d);
  const vs = histRows();
  const done = (vs || []).filter((v) => v.leftAt);
  const avg = done.length ? done.reduce((s, v) => s + (v.leftAt - v.arriveAt), 0) / done.length : 0;
  const hours = {}; (vs || []).forEach((v) => { const h = new Date(v.arriveAt + WIB).getUTCHours(); hours[h] = (hours[h] || 0) + v.pax; });
  const peak = Object.entries(hours).sort((a, b) => b[1] - a[1])[0];
  const card = (l, v, s = '') => `<div class="kpi"><small>${l}</small><b>${v}</b>${s ? `<span>${s}</span>` : ''}</div>`;
  return `<div class="hist"><div class="hist-bar"><div class="row"><button class="icon-btn" data-day="-1" aria-label="Hari sebelumnya">${ic('chevron-left')}</button><input type="date" id="h-d" value="${d}" max="${today()}"><button class="icon-btn" data-day="1" aria-label="Hari berikutnya" ${d >= today() ? 'disabled' : ''}>${ic('chevron-right')}</button>
      <span class="muted">${esc(DF.format(Date.parse(d + 'T05:00:00Z')))}</span></div>
      <div class="row"><input id="h-q" placeholder="Cari meja, nama, catatan…" value="${esc(S.hist.q)}"><select id="h-a"><option value="all">Semua area</option>${AREAS.map((a) => `<option ${S.hist.area === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select><button class="btn" data-act="export">${ic('download', 16)} Unduh Excel</button></div></div>
    ${vs ? `<div class="kpis">${card('Kunjungan', vs.length)}${card('Total tamu', vs.reduce((s, v) => s + v.pax, 0), 'orang')}${card('Rata-rata duduk', done.length ? dur(avg) : '—')}${card('Masih duduk', vs.filter((v) => !v.leftAt).length, 'meja')}${card('Jam tersibuk', peak ? `${String(peak[0]).padStart(2, '0')}.00` : '—', peak ? peak[1] + ' tamu datang' : '')}</div>
    <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>Meja</th><th>Datang</th><th>Pulang</th><th>Lama</th><th class="r">Tamu</th><th>Nama / keterangan</th><th>Catatan</th><th>Petugas</th></tr></thead><tbody>
      ${vs.map((v) => `<tr data-hk="${v.key}"><td><b>${esc(tablesOf(v).join(' + '))}</b><small>${esc(T[v.table]?.area || '')}</small></td><td>${tm(v.arriveAt)}</td><td>${v.leftAt ? tm(v.leftAt) : '<span class="badge ok">masih duduk</span>'}</td><td>${v.leftAt ? dur(v.leftAt - v.arriveAt) : `<span data-since="${v.arriveAt}"></span>`}</td><td class="r">${v.pax}</td><td>${esc(v.name || '—')}</td><td class="notes-c">${(v.notes || []).map((n) => `<span>${esc(n.text)}</span>`).join('') || '—'}</td><td><small>${esc(v.arriveBy || '')}${v.leftBy && v.leftBy !== v.arriveBy ? ' / ' + esc(v.leftBy) : ''}</small></td></tr>`).join('') || '<tr><td colspan="8" class="empty">Belum ada tamu tercatat di tanggal ini.</td></tr>'}
    </tbody></table></div>` : '<p class="empty">Memuat riwayat…</p>'}</div>`;
}
async function loadHist(d) {
  S.hist.loading = true;
  try { const r = await api('day?d=' + d); if (S.hist.d === d) S.hist.visits = r.visits; }
  catch (e) { toast(e.message, 'err'); S.hist.visits = []; }
  finally { S.hist.loading = false; if (S.view === 'riwayat') render(); }
}

// Pengaturan
function setView() {
  const c = S.cfg;
  return `<div class="set"><form id="set" class="card"><h3>Petugas & tampilan</h3>
      <label class="fld"><span>Nama petugas service (satu per baris)</span><textarea name="staff" rows="6">${esc((c.staff || []).join('\n'))}</textarea></label>
      <div class="grid2"><label class="fld"><span>Perangkat memperbarui denah setiap</span><select name="poll">${[10, 15, 20, 30, 60].map((n) => `<option value="${n}" ${c.pollSec === n ? 'selected' : ''}>${n} detik</option>`).join('')}</select></label>
      <label class="fld"><span>Tandai duduk lama setelah</span><select name="long">${[60, 90, 120, 150, 180, 240].map((n) => `<option value="${n}" ${c.longMin === n ? 'selected' : ''}>${n / 60} jam</option>`).join('')}</select></label></div>
      <p class="hint">Makin sering memperbarui, makin cepat denah di perangkat lain berubah, tapi makin banyak kuota (kredit) Netlify terpakai. <b>30 detik</b> disarankan untuk paket Netlify gratis. Perangkat yang mencatat langsung berubah tanpa menunggu, dan perangkat yang tidak disentuh 5 menit otomatis memperbarui tiap 60 detik.</p>
      <button class="btn btn-pri">Simpan</button></form>
    <form id="pins" class="card"><h3>Ganti PIN</h3><div class="grid2">
      <label class="fld"><span>PIN staf baru</span><input name="ps" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password" placeholder="kosongkan bila tidak diganti"></label>
      <label class="fld"><span>PIN admin baru</span><input name="pa" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password" placeholder="kosongkan bila tidak diganti"></label></div>
      <button class="btn">Simpan PIN</button>
      <h3 class="mt">Keamanan</h3><p class="muted sm">Mengeluarkan semua tablet & HP yang sedang masuk. Semua perangkat harus memasukkan PIN lagi. Pakai ini setelah mengganti PIN bila ada perangkat hilang atau staf berhenti.</p>
      <button type="button" class="btn btn-danger" data-act="logoutAll">${ic('lock', 16)} Keluarkan semua perangkat</button></form>
    <div class="card"><h3>Tentang data</h3><p class="muted sm">Data tamu tersimpan di Netlify Blobs pada project Netlify ini (Data & Storage → Blobs, store <b>kaly-denah</b>). Riwayat bisa diunduh sebagai file Excel (CSV) dari halaman Riwayat. Aplikasi ini terpisah dari Kaly Ops dan tidak mengubah data kasir.</p></div></div>`;
}

// ---------- Render ----------
function render() {
  const root = $('#root');
  const ae = document.activeElement, fid = ae && root.contains(ae) && ae.id ? ae.id : null, sel = fid && 'selectionStart' in ae ? [ae.selectionStart, ae.selectionEnd] : null;
  const keepScroll = $('#map-wrap') ? [$('#map-wrap').scrollLeft, $('#map-wrap').scrollTop] : null, pScroll = $('#panel')?.scrollTop;
  if (S.screen === 'setup') root.innerHTML = setupView();
  else if (S.screen === 'login') root.innerHTML = loginView(S.loginMsg);
  else if (S.screen === 'who') root.innerHTML = whoView();
  else root.innerHTML = shell();
  if (S.screen === 'main') { setSync(S.sync); if (S.view === 'denah') { fitMap(keepScroll); if (pScroll) $('#panel').scrollTop = pScroll; } }
  if (fid) { const el = document.getElementById(fid); if (el) { el.focus(); if (sel) try { el.setSelectionRange(...sel); } catch {} } }
  tick();
}
// Setelah sinkron: denah & panel diperbarui tanpa mengganggu yang sedang diketik
function refresh(force) {
  if (S.screen !== 'main') return;
  if (S.view === 'denah' && $('#pins')) {
    const occ = occupancy();
    $('#pins').innerHTML = TABLES.map((t) => pinHtml(t, occ[t.id])).join('');
    $('#stats').innerHTML = statsHtml(occ);
    const p = $('#panel'), typing = p.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
    if (!typing || force) { const st = p.scrollTop; p.innerHTML = panelHtml(occ); p.scrollTop = st; }
    tick();
  } else if (S.view === 'riwayat' && (S.hist.d || today()) === today()) { if (!$('#main').contains(document.activeElement) || document.activeElement.tagName === 'BUTTON') render(); }
}
function updateLive() { tick(); }
function tick() {
  const n = now();
  $$('[data-since]').forEach((el) => { el.textContent = dur(n - Number(el.dataset.since)); });
  const c = $('#clock'); if (c) c.textContent = tm(n);
}
setInterval(tick, 20000);

// Denah: ukuran & posisi. Saat denah diperkecil, label meja diringkas supaya tidak saling menumpuk.
function setW(map, w) { map.style.width = Math.round(w) + 'px'; map.classList.toggle('compact', w < 1500); map.classList.toggle('tiny', w < 900); }
function fitMap(keep) {
  const wrap = $('#map-wrap'), map = $('#map'); if (!wrap || !map) return;
  const fit = Math.min(wrap.clientWidth, wrap.clientHeight * (IMG.w / IMG.h));
  const w = S.zoom ? Math.max(fit, Math.min(4200, S.zoom)) : Math.max(fit, 1800);
  setW(map, w);
  if (keep) { wrap.scrollLeft = keep[0]; wrap.scrollTop = keep[1]; }
  else if (!S.zoom) { wrap.scrollLeft = 0.6 * w - wrap.clientWidth / 2; wrap.scrollTop = 0.3 * (w * IMG.h / IMG.w) - wrap.clientHeight / 2; }
}
function zoomBy(f) {
  const wrap = $('#map-wrap'), map = $('#map'); if (!wrap) return;
  const old = map.clientWidth, cx = wrap.scrollLeft + wrap.clientWidth / 2, cy = wrap.scrollTop + wrap.clientHeight / 2;
  const fit = Math.min(wrap.clientWidth, wrap.clientHeight * (IMG.w / IMG.h));
  S.zoom = Math.max(fit, Math.min(4200, old * f)); LS.set('zoom', S.zoom);
  setW(map, S.zoom);
  const k = S.zoom / old; wrap.scrollLeft = cx * k - wrap.clientWidth / 2; wrap.scrollTop = cy * k - wrap.clientHeight / 2;
}
function focusTables(ids) {
  const wrap = $('#map-wrap'), map = $('#map'); if (!wrap || !ids.length) return;
  const ts = ids.map((i) => T[i]);
  const x0 = Math.min(...ts.map((t) => t.x)) - 5, x1 = Math.max(...ts.map((t) => t.x)) + 5, y0 = Math.min(...ts.map((t) => t.y)) - 6, y1 = Math.max(...ts.map((t) => t.y)) + 6;
  const W = wrap.clientWidth, H = wrap.clientHeight, ar = IMG.w / IMG.h;
  S.zoom = Math.max(Math.min(W, H * ar), Math.min(4200, W / ((x1 - x0) / 100), (H * ar) / ((y1 - y0) / 100))); LS.set('zoom', S.zoom);
  setW(map, S.zoom);
  wrap.scrollLeft = ((x0 + x1) / 200) * S.zoom - W / 2; wrap.scrollTop = ((y0 + y1) / 200) * (S.zoom / ar) - H / 2;
}
function revealTable(id) {
  const wrap = $('#map-wrap'), t = T[id]; if (!wrap || !t) return;
  const w = $('#map').clientWidth, h = w * IMG.h / IMG.w, px = t.x / 100 * w, py = t.y / 100 * h;
  if (px < wrap.scrollLeft + 30 || px > wrap.scrollLeft + wrap.clientWidth - 30 || py < wrap.scrollTop + 30 || py > wrap.scrollTop + wrap.clientHeight - 30) { wrap.scrollLeft = px - wrap.clientWidth / 2; wrap.scrollTop = py - wrap.clientHeight / 2; }
}

// ---------- Jam ----------
// "HH:MM" (WIB) → waktu; kalau jamnya di depan (lewat tengah malam), pakai hari sebelumnya
function parseTime(hm) {
  if (!hm) return null;
  const [h, m] = hm.split(':').map(Number);
  let t = Date.parse(today() + 'T00:00:00Z') - WIB + (h * 60 + m) * 60000;
  if (t > now() + 10 * 60000) t -= 86400000;
  return t;
}
const hmOf = (ms) => new Date(ms + WIB).toISOString().slice(11, 16);

// ---------- Aksi ----------
async function doArrive(form) {
  const f = S.form;
  const pax = Math.round(Number($('#f-pax').value));
  if (!(pax >= 1)) return toast('Isi jumlah tamu', 'warn');
  const btn = form.querySelector('button.btn-pri'); btn.disabled = true;
  try {
    const at = parseTime($('#f-time').value);
    const r = await api('arrive', { table: f.t, join: f.join, pax, name: $('#f-name').value, note: $('#f-note').value, at, by: by() });
    put(r); S.form = {};
    toast(`Meja ${[f.t, ...f.join].join(' + ')} terisi, ${pax} tamu`);
    refresh(true);
  } catch (e) { toast(e.message, 'err'); if (/terisi/.test(e.message)) sync(true); }
  finally { btn.disabled = false; }
}
async function doNote(key, text) {
  if (!text.trim()) return;
  try { put(await api('note', { key, text, by: by() })); S.form = { k: key, note: '' }; refresh(true); toast('Catatan disimpan'); }
  catch (e) { toast(e.message, 'err'); }
}
const visitOf = (k) => S.visits.get(k)?.data || S.hist.visits?.find((x) => x.key === k);
async function doLeave(key) {
  const v = visitOf(key); if (!v) return;
  modal(`Tamu meja ${tablesOf(v).join(' + ')} pulang`, `<p>${v.pax} tamu, datang ${tm(v.arriveAt)}. Lama duduk <b>${dur(now() - v.arriveAt)}</b>.</p>
    <label class="fld inline"><span>Jam pulang</span><input name="t" type="time" value=""><small class="muted">kosongkan = sekarang</small></label>
    <label class="fld"><span>Catatan penutup <em>(opsional)</em></span><input name="n" maxlength="300" placeholder="mis. puas, minta reservasi lagi"></label>`, {
    ok: 'Tamu pulang, meja kosong', onOk: async (m) => {
      const at = parseTime(m.querySelector('[name=t]').value) || undefined;
      const r = await api('leave', { key, at, note: m.querySelector('[name=n]').value, by: by() });
      put(r); S.sel = null; S.form = {}; refresh();
      toast(`Meja ${tablesOf(v).join(' + ')} kosong. Tamu duduk ${dur(r.data.leftAt - r.data.arriveAt)}.`, 'ok', { action: 'Batalkan', onAction: () => doReopen(key) });
    } });
}
async function doReopen(key) {
  try { put(await api('reopen', { key })); refresh(); toast('Tamu dikembalikan ke meja'); } catch (e) { toast(e.message, 'err'); }
}
function doEdit(key) {
  const v = visitOf(key); if (!v) return;
  modal(`Ubah data meja ${tablesOf(v).join(' + ')}`, `<div class="grid2"><label class="fld"><span>Jumlah tamu</span><input name="pax" type="number" min="1" max="200" value="${v.pax}"></label>
    <label class="fld"><span>Jam datang</span><input name="t" type="time" value="${hmOf(v.arriveAt)}"></label>
    ${v.leftAt ? `<label class="fld"><span>Jam pulang</span><input name="tl" type="time" value="${hmOf(v.leftAt)}"></label>` : ''}</div>
    <label class="fld"><span>Nama / keterangan</span><input name="name" maxlength="80" value="${esc(v.name)}"></label>`, {
    onOk: async (m) => {
      const patch = { pax: Number(m.querySelector('[name=pax]').value), name: m.querySelector('[name=name]').value };
      const hm = m.querySelector('[name=t]').value; if (hm && hm !== hmOf(v.arriveAt)) patch.arriveAt = Date.parse(v.day + 'T' + hm + ':00Z') - WIB;
      const tl = m.querySelector('[name=tl]')?.value; if (tl && tl !== hmOf(v.leftAt)) { let t = Date.parse(dayOf(v.leftAt) + 'T' + tl + ':00Z') - WIB; if (t < (patch.arriveAt || v.arriveAt)) t += 86400000; patch.leftAt = t; }
      put(await api('edit', { key, patch })); refresh(); if (S.view === 'riwayat') { if (S.hist.d && S.hist.d !== today()) S.hist.visits = null; render(); } toast('Data diperbarui');
    } });
}
function doMove(key) {
  const v = visitOf(key); if (!v) return;
  const occ = occupancy();
  const mine = tablesOf(v);
  let pick = [...mine];
  const draw = (m) => {
    m.querySelector('.mv').innerHTML = AREAS.map((a) => {
      const ts = TABLES.filter((t) => t.area === a);
      return `<h4 class="sec">${esc(a)}</h4><div class="chips sm">${ts.map((t) => { const taken = occ[t.id] && occ[t.id].key !== key; return `<button type="button" class="chip ${pick.includes(t.id) ? 'on' : ''}" data-mv="${t.id}" ${taken ? 'disabled title="Terisi"' : ''}>${t.id}${pick[0] === t.id ? ' ★' : ''}</button>`; }).join('')}</div>`;
    }).join('');
    m.querySelector('.mv-sum').textContent = pick.length ? `Meja baru: ${pick.join(' + ')} (★ = meja utama)` : 'Pilih minimal satu meja';
  };
  const m = modal(`Pindah / gabung meja ${mine.join(' + ')}`, `<p class="muted sm">Ketuk meja tujuan. Ketuk beberapa meja untuk menggabungkan. Meja pertama yang dipilih jadi meja utama.</p><p class="mv-sum"></p><div class="mv"></div>`, {
    ok: 'Simpan meja', wide: true, onOk: async () => {
      if (!pick.length) { toast('Pilih minimal satu meja', 'warn'); return false; }
      put(await api('move', { key, table: pick[0], join: pick.slice(1) })); S.sel = pick[0]; S.form = {}; refresh(); toast(`Tamu dipindah ke meja ${pick.join(' + ')}`);
    } });
  m.addEventListener('click', (e) => { const b = e.target.closest('[data-mv]'); if (!b) return; const id = b.dataset.mv; pick = pick.includes(id) ? pick.filter((x) => x !== id) : [...pick, id]; draw(m); });
  draw(m);
}
function doDelete(key) {
  const v = visitOf(key) || S.hist.visits?.find((x) => x.key === key); if (!v) return;
  modal('Hapus data kunjungan', `<p>Hapus data meja <b>${esc(tablesOf(v).join(' + '))}</b>, ${v.pax} tamu, datang ${tm(v.arriveAt)}? Data yang dihapus tidak bisa dikembalikan. Pakai hanya untuk salah input.</p>`, {
    ok: 'Hapus', danger: true, onOk: async () => { put(await api('delete', { key })); S.sel = null; if (S.hist.visits) S.hist.visits = S.hist.visits.filter((x) => x.key !== key); refresh(); if (S.view === 'riwayat') render(); toast('Data dihapus'); } });
}
function histDetail(key) {
  const v = (S.hist.d && S.hist.d !== today() ? S.hist.visits : [...S.visits.values()].map((x) => x.data)).find((x) => x.key === key); if (!v) return;
  const canEdit = S.role === 'admin' || v.day === today();
  modal(`Meja ${tablesOf(v).join(' + ')} · ${v.day.split('-').reverse().join('/')}`, `<dl class="kv"><dt>Tamu</dt><dd>${v.pax} orang${v.name ? ' · ' + esc(v.name) : ''}</dd><dt>Datang</dt><dd>${tm(v.arriveAt)} (${esc(v.arriveBy || '—')})</dd><dt>Pulang</dt><dd>${v.leftAt ? `${tm(v.leftAt)} (${esc(v.leftBy || '—')})` : 'masih duduk'}</dd><dt>Lama duduk</dt><dd>${dur((v.leftAt || now()) - v.arriveAt)}</dd></dl>
    <h4 class="sec">Catatan</h4>${(v.notes || []).length ? `<ul class="notes">${v.notes.map((n) => `<li><span class="n-t">${tm(n.at)}</span><span class="n-x">${esc(n.text)}<small>${esc(n.by || '')}</small></span></li>`).join('')}</ul>` : '<p class="empty sm">Tidak ada catatan.</p>'}
    <div class="row">${canEdit ? `<button class="btn" data-act="edit" data-k="${v.key}">${ic('square-pen', 16)} Ubah jam / jumlah</button>` : ''}${S.role === 'admin' ? `<button class="btn btn-ghost danger" data-act="del" data-k="${v.key}">${ic('trash-2', 15)} Hapus</button>` : ''}</div>`, {});
}
function doExport() {
  const d = S.hist.d || today();
  modal('Unduh riwayat tamu (Excel)', `<div class="grid2"><label class="fld"><span>Dari tanggal</span><input name="f" type="date" value="${d.slice(0, 8)}01" max="${today()}"></label><label class="fld"><span>Sampai tanggal</span><input name="t" type="date" value="${d}" max="${today()}"></label></div><p class="hint">File CSV bisa dibuka di Excel atau Google Sheets. Maksimal 62 hari sekali unduh.</p>`, {
    ok: 'Unduh', onOk: async (m) => {
      const f = m.querySelector('[name=f]').value, t = m.querySelector('[name=t]').value;
      const r = await fetch(`/api/export?from=${f}&to=${t}`, { headers: { authorization: 'Bearer ' + S.token } });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Gagal mengunduh');
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a'); a.href = url; a.download = `tamu-kaly-${f}_${t}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    } });
}
// ---------- Atur meja (PIN admin) ----------
async function tablesApi(op, table) {
  const r = await api('tables', { op, table });
  setCfg(r.cfg);
  return r;
}
function tableForm(t, at) {
  const areas = AREAS.length ? AREAS : BASE_AREAS;
  const near = at && TABLES.slice().sort((a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y))[0]?.area;
  const pick = t?.area || near || areas[0];
  const busy = t && occupancy()[t.id];
  const m = modal(t ? `Meja ${t.id}` : 'Tambah meja', `<div class="grid2">
      <label class="fld"><span>Kode meja</span><input name="id" value="${esc(t?.id || '')}" ${t ? 'readonly' : ''} maxlength="6" placeholder="mis. PR7" autocapitalize="characters" style="text-transform:uppercase"></label>
      <label class="fld"><span>Jumlah kursi</span><input name="seats" type="number" inputmode="numeric" min="1" max="40" value="${t?.seats || 4}"></label></div>
    <label class="fld"><span>Area</span><select name="area">${areas.map((a) => `<option ${a === pick ? 'selected' : ''}>${esc(a)}</option>`).join('')}<option value="__new">+ Area baru…</option></select></label>
    <label class="fld" data-newarea hidden><span>Nama area baru</span><input name="newArea" maxlength="40" placeholder="mis. Rooftop"></label>
    <label class="check"><input type="checkbox" name="gazebo" ${t?.gazebo ? 'checked' : ''}> Meja gazebo (tanda emas di denah)</label>
    ${t ? `<p class="hint">Untuk memindah meja, tutup jendela ini lalu seret mejanya di denah.</p>
      <button type="button" class="btn btn-ghost danger" data-tdel ${busy ? 'disabled' : ''}>${ic('trash-2', 15)} Hapus meja ${esc(t.id)}</button>${busy ? '<p class="hint">Meja sedang terisi tamu, pulangkan dulu sebelum dihapus.</p>' : ''}`
      : '<p class="hint">Meja muncul di tempat yang Anda ketuk. Seret untuk merapikan posisinya.</p>'}`, {
    ok: t ? 'Simpan' : 'Tambah meja',
    onOk: async (root) => {
      const v = (n) => root.querySelector(`[name=${n}]`);
      const area = v('area').value === '__new' ? v('newArea').value.trim() : v('area').value;
      if (!area) { toast('Isi nama area', 'warn'); return false; }
      const id = v('id').value.trim().toUpperCase().replace(/\s+/g, '');
      if (!t && !/^[A-Z0-9-]{1,6}$/.test(id)) { toast('Kode meja 1 sampai 6 huruf/angka, mis. PR7', 'warn'); return false; }
      if (!t && T[id]) { toast(`Kode meja ${id} sudah dipakai`, 'warn'); return false; }
      const table = { id: t ? t.id : id, area, seats: Number(v('seats').value) || 4, gazebo: v('gazebo').checked, ...(t ? {} : { x: at.x, y: at.y }) };
      await tablesApi(t ? 'update' : 'add', table);
      toast(t ? `Meja ${t.id} disimpan` : `Meja ${id} ditambahkan. Seret untuk merapikan posisinya.`);
      render();
    },
  });
  const sel = m.querySelector('[name=area]');
  sel.onchange = () => { m.querySelector('[data-newarea]').hidden = sel.value !== '__new'; };
  const del = m.querySelector('[data-tdel]');
  if (del) del.onclick = () => { m.remove(); modal(`Hapus meja ${t.id}?`, '<p>Meja hilang dari denah di semua perangkat. Riwayat tamu lama di meja ini tetap tersimpan.</p>', { ok: 'Hapus meja', danger: true, onOk: async () => { await tablesApi('remove', { id: t.id }); toast(`Meja ${t.id} dihapus`); render(); } }); };
}
// Seret meja saat Atur meja
let drag = null, dragDone = 0;
document.addEventListener('pointerdown', (e) => {
  if (!S.edit) return;
  const p = e.target.closest('#map .pin[data-t]'); if (!p) return;
  drag = { el: p, id: p.dataset.t, x0: e.clientX, y0: e.clientY, moved: false, pid: e.pointerId };
});
document.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pid) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
  if (!drag.moved) { drag.moved = true; drag.el.classList.add('dragging'); try { drag.el.setPointerCapture(e.pointerId); } catch {} }
  const r = $('#map').getBoundingClientRect();
  drag.x = Math.min(99, Math.max(1, ((e.clientX - r.left) / r.width) * 100));
  drag.y = Math.min(99, Math.max(1, ((e.clientY - r.top) / r.height) * 100));
  drag.el.style.left = drag.x + '%'; drag.el.style.top = drag.y + '%';
  e.preventDefault();
}, { passive: false });
const endDrag = async (e) => {
  if (!drag || e.pointerId !== drag.pid) return;
  const d = drag; drag = null;
  if (!d.moved) return;
  dragDone = Date.now() + 400;
  d.el.classList.remove('dragging');
  try { await tablesApi('update', { id: d.id, x: d.x, y: d.y }); refresh(); }
  catch (err) { toast(err.message, 'err'); refresh(); }
};
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

function logout(msg) {
  S.token = null; S.role = null; LS.set('token', null); LS.set('role', null); S.visits.clear(); clearTimeout(syncT);
  S.screen = 'login'; S.loginMsg = msg || ''; render();
}

// ---------- Event ----------
document.addEventListener('click', async (e) => {
  const el = (s) => e.target.closest(s);
  let b;
  if ((b = el('[data-k]')) && b.closest('.keypad')) return keypad(b.dataset.k);
  if ((b = el('[data-who]'))) { S.me = b.dataset.who; LS.set('me', S.me); S.screen = 'main'; render(); sync(true); return; }
  if ((b = el('[data-view]'))) { S.view = b.dataset.view; if (S.view === 'riwayat') { S.hist.d = S.hist.d || today(); } render(); if (S.view === 'denah' && S.sel) revealTable(S.sel); return; }
  if (S.edit && S.view === 'denah') {
    if (Date.now() < dragDone) return;
    if ((b = el('#map .pin[data-t]'))) return tableForm(T[b.dataset.t]);
    if (el('#map')) { const r = $('#map').getBoundingClientRect(); return tableForm(null, { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 }); }
  }
  if ((b = el('.pin[data-t], .li[data-t]'))) { const id = b.dataset.t; S.sel = S.sel === id && b.classList.contains('pin') ? null : id; S.form = {}; refresh(); if (!b.classList.contains('pin')) revealTable(id); return; }
  if ((b = el('[data-filter]'))) { S.filter = b.dataset.filter; refresh(); return; }
  if ((b = el('[data-zoom]'))) { const z = b.dataset.zoom; if (z === 'fit') { S.zoom = 1; LS.set('zoom', 1); fitMap(); $('#map-wrap').scrollTo(0, 0); } else zoomBy(z === 'in' ? 1.3 : 1 / 1.3); return; }
  if ((b = el('[data-step]'))) { const i = $('#f-pax'); i.value = Math.max(1, Math.min(200, (Number(i.value) || 0) + Number(b.dataset.step))); S.form.pax = i.value; $$('[data-pax]').forEach((c) => c.classList.toggle('on', Number(c.dataset.pax) === Number(i.value))); return; }
  if ((b = el('[data-pax]'))) { $('#f-pax').value = b.dataset.pax; S.form.pax = b.dataset.pax; $$('[data-pax]').forEach((c) => c.classList.toggle('on', c === b)); return; }
  if ((b = el('[data-tag]'))) { const i = $('#f-note'); i.value = i.value ? i.value.replace(/[,\s]*$/, '') + ', ' + b.dataset.tag : b.dataset.tag; S.form.note = i.value; return; }
  if ((b = el('[data-join]'))) { const id = b.dataset.join; S.form.join = S.form.join.includes(id) ? S.form.join.filter((x) => x !== id) : [...S.form.join, id]; b.classList.toggle('on'); return; }
  if ((b = el('[data-qnote]'))) return doNote(b.dataset.k, b.dataset.qnote);
  if ((b = el('[data-day]'))) { const d = new Date(Date.parse((S.hist.d || today()) + 'T00:00:00Z') + Number(b.dataset.day) * 86400000).toISOString().slice(0, 10); if (d > today()) return; S.hist.d = d; S.hist.visits = null; render(); return; }
  if ((b = el('tr[data-hk]'))) return histDetail(b.dataset.hk);
  if ((b = el('[data-act]'))) {
    const a = b.dataset.act, k = b.dataset.k;
    if (a === 'unsel') { S.sel = null; S.form = {}; refresh(); }
    else if (a === 'edit-on') { S.edit = true; S.sel = null; render(); toast('Ketuk tempat kosong untuk menambah meja, seret meja untuk memindah.', 'ok', { ms: 4500 }); }
    else if (a === 'edit-off') { S.edit = false; render(); }
    else if (a === 't-add') { const w = $('#map-wrap'), m = $('#map'); tableForm(null, w && m ? { x: ((w.scrollLeft + w.clientWidth / 2) / m.clientWidth) * 100, y: ((w.scrollTop + w.clientHeight / 2) / m.clientHeight) * 100 } : { x: 50, y: 50 }); }
    else if (a === 'leave') doLeave(k);
    else if (a === 'edit') { $$('.modal-back').forEach((m) => m.remove()); doEdit(k); }
    else if (a === 'move') doMove(k);
    else if (a === 'del') { $$('.modal-back').forEach((m) => m.remove()); doDelete(k); }
    else if (a === 'reopen') doReopen(k);
    else if (a === 'note-del') { try { put(await api('note-del', { key: k, at: Number(b.dataset.at) })); refresh(); } catch (err) { toast(err.message, 'err'); } }
    else if (a === 'export') doExport();
    else if (a === 'who') { S.screen = 'who'; render(); }
    else if (a === 'logout') modal('Keluar dari perangkat ini?', '<p>Perangkat ini perlu PIN lagi untuk membuka denah.</p>', { ok: 'Keluar', onOk: () => logout() });
    else if (a === 'logoutAll') modal('Keluarkan semua perangkat?', '<p>Semua tablet dan HP harus memasukkan PIN lagi. Perangkat ini tetap masuk.</p>', { ok: 'Keluarkan semua', danger: true, onOk: async () => { const r = await api('config', { logoutAll: true }); S.token = r.token; LS.set('token', r.token); toast('Semua perangkat lain sudah dikeluarkan'); } });
  }
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'pin-in') { t.value = t.value.replace(/\D/g, '').slice(0, 8); paintDots(); return; }
  if (t.id === 'f-pax') S.form.pax = t.value; if (t.id === 'f-name') S.form.name = t.value; if (t.id === 'f-note') S.form.note = t.value; if (t.id === 'f-time') S.form.time = t.value;
  if (t.id === 'f-n') S.form.note = t.value;
  if (t.id === 'h-q') { S.hist.q = t.value; const pos = t.selectionStart; render(); const i = $('#h-q'); i.focus(); i.setSelectionRange(pos, pos); }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'area') { S.area = t.value; if (t.value === 'all') { S.zoom = 1; fitMap(); $('#map-wrap').scrollTo(0, 0); } else focusTables(TABLES.filter((x) => x.area === t.value).map((x) => x.id)); }
  if (t.id === 'h-d' && t.value) { S.hist.d = t.value > today() ? today() : t.value; S.hist.visits = null; render(); }
  if (t.id === 'h-a') { S.hist.area = t.value; render(); }
});
document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, v = (n) => f.querySelector(`[name=${n}]`)?.value ?? '';
  if (f.id === 'arrive') return doArrive(f);
  if (f.id === 'note') return doNote(f.dataset.k, v('text'));
  if (f.id === 'who-other') { const n = v('n').trim(); if (!n) return toast('Isi nama petugas', 'warn'); S.me = n; LS.set('me', n); S.screen = 'main'; render(); sync(true); return; }
  if (f.id === 'setup') {
    if (!/^\d{4,8}$/.test(v('ps')) || !/^\d{4,8}$/.test(v('pa'))) return toast('PIN harus 4 sampai 8 angka', 'warn');
    if (v('ps') !== v('ps2') || v('pa') !== v('pa2')) return toast('Pengulangan PIN tidak sama', 'warn');
    try {
      const r = await api('setup', { pinStaff: v('ps'), pinAdmin: v('pa'), staff: v('staff').split('\n') });
      signedIn(r); toast('Denah siap dipakai. Simpan PIN di tempat aman.');
    } catch (err) { toast(err.message, 'err'); }
    return;
  }
  if (f.id === 'set') {
    try { const r = await api('config', { staff: v('staff').split('\n'), pollSec: Number(v('poll')), longMin: Number(v('long')) }); setCfg(r.cfg); toast('Pengaturan disimpan'); render(); schedule(); }
    catch (err) { toast(err.message, 'err'); }
    return;
  }
  if (f.id === 'pins') {
    if (!v('ps') && !v('pa')) return toast('Isi PIN baru yang ingin diganti', 'warn');
    try { await api('config', { pinStaff: v('ps') || undefined, pinAdmin: v('pa') || undefined }); f.reset(); toast('PIN diganti. Beri tahu staf PIN yang baru.'); }
    catch (err) { toast(err.message, 'err'); }
  }
});
// Keypad PIN
function paintDots() { const n = ($('#pin-in')?.value || '').length; const d = $('#pin-dots'); if (d) d.innerHTML = '<i class="on"></i>'.repeat(n) + '<i></i>'.repeat(Math.max(0, 4 - n)); }
async function keypad(k) {
  const i = $('#pin-in'); if (!i) return;
  if (k === 'del') i.value = i.value.slice(0, -1);
  else if (k === 'ok') return login(i.value);
  else if (i.value.length < 8) i.value += k;
  paintDots();
}
// Di komputer, PIN bisa diketik langsung dengan keyboard
document.addEventListener('keydown', (e) => {
  if (S.screen !== 'login' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^\d$/.test(e.key)) { e.preventDefault(); keypad(e.key); } else if (e.key === 'Backspace') { e.preventDefault(); keypad('del'); } else if (e.key === 'Enter') { e.preventDefault(); keypad('ok'); }
});
async function login(pin) {
  if (!/^\d{4,8}$/.test(pin)) return toast('PIN 4 sampai 8 angka', 'warn');
  try { signedIn(await api('login', { pin })); }
  catch (e) { const i = $('#pin-in'); if (i) { i.value = ''; paintDots(); } $('.gate-card')?.classList.add('shake'); setTimeout(() => $('.gate-card')?.classList.remove('shake'), 400); toast(e.message, 'err'); }
}
function signedIn(r) {
  S.token = r.token; S.role = r.role; LS.set('token', r.token); LS.set('role', r.role); setCfg(r.cfg);
  S.screen = S.me ? 'main' : 'who'; render(); sync(true);
}

// ---------- Mulai ----------
async function start() {
  try {
    const h = await api('hello');
    S.skew = h.now - Date.now();
    if (!h.setup) { S.screen = 'setup'; return render(); }
    if (!S.token) { S.screen = 'login'; return render(); }
    S.screen = S.me ? 'main' : 'who'; render(); sync(true);
  } catch (e) {
    $('#root').innerHTML = `<div class="gate"><div class="gate-card">${logo()}<h1>Tidak bisa terhubung</h1><p class="muted">${esc(e.message)}</p><button class="btn btn-pri" onclick="location.reload()">Coba lagi</button></div></div>`;
  }
}
window.addEventListener('resize', () => { if (S.screen === 'main' && S.view === 'denah') fitMap([$('#map-wrap')?.scrollLeft || 0, $('#map-wrap')?.scrollTop || 0]); });
start();
