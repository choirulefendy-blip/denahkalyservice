// Uji "server" Denah Service (backend.js di browser) terhadap tiruan GitHub API. Tiap alamat IP = satu perangkat.
import { startMockGitHub } from './mock-github.mjs';
const gh = await startMockGitHub({ raceRate: Number(process.env.RACE || 0) });
globalThis.KALY_GH_API = gh.url;
const stores = new Map();
const LSFor = (ip) => { if (!stores.has(ip)) stores.set(ip, new Map()); const m = stores.get(ip); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const { Backend } = await import('../public/backend.js');
const devices = new Map();
let pass = 0, fail = 0; const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + JSON.stringify(x)?.slice(0, 300))); };
async function call(p, body, tok, ip = '1.1.1.1') {
  globalThis.localStorage = LSFor(ip);
  if (!devices.has(ip)) devices.set(ip, new Backend({ repo: 'kaly/denah-data', token: gh.token }));
  try { const data = await devices.get(ip).call(p, body || {}, tok); return { status: 200, data }; }
  catch (e) { return { status: e.status || (e.conflict ? 409 : 500), data: { error: e.message } }; }
}
let r = await call('hello'); ok('belum disiapkan', r.data.setup === false, r);
r = await call('sync', {}); ok('tanpa setup ditolak', r.status === 428, r);
r = await call('setup', { pinStaff: '1111', pinAdmin: '1111' }); ok('PIN sama ditolak', r.status === 400, r);
r = await call('setup', { pinStaff: '2468', pinAdmin: '135790', staff: ['Wulan', 'Agus', 'Wulan', ''] });
ok('setup berhasil, token admin', r.status === 200 && r.data.role === 'admin' && r.data.cfg.staff.length === 2, r);
const admin = r.data.token;
r = await call('setup', { pinStaff: '1234', pinAdmin: '5678' }); ok('setup kedua ditolak', r.status === 403, r);
r = await call('login', { pin: '0000' }); ok('PIN salah', r.status === 401, r);
r = await call('login', { pin: '2468' }); ok('login staf', r.data.role === 'staff', r);
const staff = r.data.token;
r = await call('sync', {}, 'palsu.token'); ok('token palsu ditolak', r.status === 401, r);
r = await call('arrive', { table: 'G1', pax: 4, name: 'Keluarga Hadi', note: 'ulang tahun', by: 'Wulan' }, staff);
ok('tamu datang di G1', r.status === 200 && r.data.data.table === 'G1' && r.data.data.notes.length === 1, r);
const k1 = r.data.key;
r = await call('arrive', { table: 'G1', pax: 2, by: 'Agus' }, staff); ok('G1 tidak bisa diisi dua kali', r.status === 409, r);
r = await call('arrive', { table: 'ZZ9', pax: 2 }, staff); ok('meja tak dikenal ditolak', r.status === 400, r);
r = await call('arrive', { table: 'PR5', join: ['PR6'], pax: 8, name: 'Rombongan', by: 'Agus' }, staff); ok('rombongan gabung PR5+PR6', r.status === 200, r);
const k2 = r.data.key;
r = await call('arrive', { table: 'PR6', pax: 2 }, staff); ok('meja gabungan ikut terkunci', r.status === 409, r);
r = await call('sync', { known: {} }, staff); ok('sync mengirim 2 kunjungan', r.data.keys.length === 2 && Object.keys(r.data.changed).length === 2, r.data.keys);
const known = Object.fromEntries(Object.entries(r.data.changed).map(([k, v]) => [k, v.etag]));
r = await call('sync', { known }, staff); ok('sync kedua tidak mengirim ulang yang tidak berubah', Object.keys(r.data.changed).length === 0, r.data);
r = await call('note', { key: k1, text: 'minta kursi bayi', by: 'Agus' }, staff); ok('tambah catatan', r.data.data.notes.length === 2, r);
r = await call('sync', { known }, staff); ok('sync hanya mengirim yang berubah', Object.keys(r.data.changed).length === 1 && r.data.changed[k1], Object.keys(r.data.changed));
r = await call('move', { key: k1, table: 'G2' }, staff); ok('pindah G1 → G2', r.data.data.table === 'G2', r);
r = await call('arrive', { table: 'G1', pax: 3, by: 'Agus' }, staff); ok('G1 kosong lagi setelah pindah', r.status === 200, r);
const k3 = r.data.key;
r = await call('arrive', { table: 'G2', pax: 1 }, staff); ok('G2 terkunci setelah pindah', r.status === 409, r);
r = await call('edit', { key: k1, patch: { pax: 5, name: 'Keluarga Hadi (5)' } }, staff); ok('ubah jumlah tamu', r.data.data.pax === 5, r);
r = await call('leave', { key: k1, by: 'Wulan', note: 'puas, kasih ulasan' }, staff); ok('tamu pulang', r.data.data.leftAt > 0 && r.data.data.leftBy === 'Wulan', r);
r = await call('arrive', { table: 'G2', pax: 2, by: 'Agus' }, staff); ok('G2 kosong setelah pulang', r.status === 200, r);
const k4 = r.data.key;
r = await call('reopen', { key: k1 }, staff); ok('batal pulang ditolak kalau meja sudah terisi lagi', r.status === 409, r);
await call('leave', { key: k4, by: 'Agus' }, staff);
r = await call('reopen', { key: k1 }, staff); ok('batal pulang berhasil saat meja kosong', r.status === 200 && r.data.data.leftAt === null, r);
await call('leave', { key: k1, by: 'Wulan' }, staff);
r = await call('delete', { key: k4 }, staff); ok('staf tidak bisa menghapus', r.status === 403, r);
r = await call('delete', { key: k4 }, admin); ok('admin menghapus data salah input', r.data.deleted === true, r);
const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
r = await call('day?d=' + today, undefined, staff); ok('riwayat hari ini', r.data.visits.length === 3, r.data.visits?.length);
r = await call('export', { from: today, to: today }, staff); const csv = r.data.csv || '';
ok('ekspor CSV', csv.startsWith('\ufeffsep=;') && csv.includes('Keluarga Hadi (5)') && csv.split('\n').length >= 5, csv.slice(0, 300));
r = await call('config', { staff: ['Wulan', 'Agus', 'Rina'], pollSec: 15 }, staff); ok('staf tidak bisa ubah pengaturan', r.status === 403, r);
r = await call('config', { staff: ['Wulan', 'Agus', 'Rina'], pollSec: 15, longMin: 90 }, admin); ok('admin ubah pengaturan', r.data.cfg.staff.length === 3 && r.data.cfg.pollSec === 15 && r.data.cfg.longMin === 90, r);
r = await call('config', { pinStaff: '135790' }, admin); ok('PIN staf baru tidak boleh sama dengan PIN admin', r.status === 400, r);
r = await call('config', { logoutAll: true }, admin); const admin2 = r.data.token;
r = await call('sync', {}, staff); ok('keluarkan semua perangkat: token lama mati', r.status === 401, r);
r = await call('sync', {}, admin2); ok('token admin baru tetap jalan', r.status === 200, r);
for (let i = 0; i < 5; i++) r = await call('login', { pin: '9999' }, undefined, '9.9.9.9');
ok('5x PIN salah → terkunci', r.status === 401 && /5 kali/.test(r.data.error), r);
r = await call('login', { pin: '2468' }, undefined, '9.9.9.9'); ok('saat terkunci PIN benar pun ditolak', r.status === 429, r);
r = await call('login', { pin: '2468' }, undefined, '8.8.8.8'); ok('perangkat lain tidak ikut terkunci', r.status === 200, r);
// tulis bersamaan dari dua perangkat
const t2 = r.data.token;
const res = await Promise.all([1, 2, 3, 4, 5].map((i) => call('note', { key: k2, text: 'catatan ' + i, by: 'x' }, t2)));
r = await call('sync', { known: {} }, t2);
ok('5 catatan bersamaan tidak ada yang hilang', res.every((x) => x.status === 200) && r.data.changed[k2].data.notes.length === 5, res.map((x) => x.status));
const race = await Promise.all([call('arrive', { table: 'R1', pax: 2 }, t2), call('arrive', { table: 'R1', pax: 3 }, t2)]);
ok('dua perangkat isi meja R1 bersamaan: hanya satu berhasil', race.filter((x) => x.status === 200).length === 1, race.map((x) => x.status));
// ---------- dua perangkat berbeda bersamaan ----------
{
  const tA = (await call('login', { pin: '2468' }, undefined, '5.5.5.1')).data.token, tB = (await call('login', { pin: '2468' }, undefined, '5.5.5.2')).data.token;
  const two = await Promise.all([call('arrive', { table: 'R2', pax: 2, by: 'A' }, tA, '5.5.5.1'), call('arrive', { table: 'R2', pax: 4, by: 'B' }, tB, '5.5.5.2')]);
  ok('2 tablet berbeda isi meja R2 bersamaan: hanya satu berhasil', two.filter((x) => x.status === 200).length === 1, two.map((x) => [x.status, x.data.error]));
  const kk = two.find((x) => x.status === 200).data.key;
  const notes = await Promise.all([call('note', { key: kk, text: 'dari A', by: 'A' }, tA, '5.5.5.1'), call('note', { key: kk, text: 'dari B', by: 'B' }, tB, '5.5.5.2')]);
  const v = (await call('sync', { known: {} }, tA, '5.5.5.1')).data.changed[kk].data;
  ok('2 tablet menulis catatan bersamaan: dua-duanya tersimpan', notes.every((x) => x.status === 200) && v.notes.length === 2, [notes.map((x) => x.status), v.notes]);
  const r2 = await call('sync', { known: Object.fromEntries(Object.entries((await call('sync', { known: {} }, tB, '5.5.5.2')).data.changed).map(([k, x]) => [k, x.etag])) }, tB, '5.5.5.2');
  ok('sinkron tanpa perubahan: tidak mengunduh ulang', Object.keys(r2.data.changed).length === 0, r2.data);
}
// ---------- Atur meja (PIN admin) ----------
{
  const tok = t2, adminTok = admin2;   // staf & admin yang masih masuk
  let q;
  q = await call('tables', { op: 'add', table: { id: 'X1', area: 'Rooftop', seats: 6, x: 40, y: 40 } }, tok);
  ok('staf tidak bisa menambah meja', q.status === 403, q);
  q = await call('tables', { op: 'add', table: { id: 'x 1', area: 'Rooftop', seats: 6, x: 40, y: 40, gazebo: true } }, adminTok);
  ok('admin menambah meja X1 (area baru, gazebo)', q.status === 200 && q.data.cfg.tables.some((t) => t.id === 'X1' && t.area === 'Rooftop' && t.seats === 6 && t.gazebo), q.data);
  ok('daftar meja = bawaan + 1', q.data.cfg.tables.length === 43, q.data.cfg.tables.length);
  q = await call('tables', { op: 'add', table: { id: 'G1', area: 'Garden', x: 1, y: 1 } }, adminTok); ok('kode meja dobel ditolak', q.status === 400, q);
  q = await call('tables', { op: 'add', table: { id: 'TOOLONG9', area: 'A' } }, adminTok); ok('kode meja terlalu panjang ditolak', q.status === 400, q);
  q = await call('sync', {}, tok); ok('perangkat lain menerima meja baru lewat sinkron', q.data.cfg.tables?.some((t) => t.id === 'X1'), q.data.cfg);
  q = await call('arrive', { table: 'X1', pax: 5, by: 'Wulan' }, tok); ok('tamu bisa duduk di meja baru', q.status === 200, q); const kx = q.data.key;
  q = await call('tables', { op: 'update', table: { id: 'X1', x: 120, y: 33.333, seats: 99 } }, adminTok);
  const x1 = q.data.cfg.tables.find((t) => t.id === 'X1');
  ok('pindah & ubah meja (posisi & kursi dibatasi)', x1.x === 99 && x1.y === 33.33 && x1.seats === 40 && x1.area === 'Rooftop', x1);
  q = await call('tables', { op: 'remove', table: { id: 'X1' } }, adminTok); ok('meja terisi tidak bisa dihapus', q.status === 409, q);
  await call('leave', { key: kx, by: 'Wulan' }, tok);
  q = await call('tables', { op: 'remove', table: { id: 'X1' } }, adminTok); ok('meja kosong dihapus', q.status === 200 && !q.data.cfg.tables.some((t) => t.id === 'X1'), q);
  q = await call('arrive', { table: 'X1', pax: 2 }, tok); ok('meja yang dihapus tidak bisa dipakai', q.status === 400, q);
  q = await call('tables', { op: 'hapus-semua' }, adminTok); ok('perintah tidak dikenal ditolak', q.status === 400, q);
}
// ---------- lupa PIN admin: reset-pin.txt ----------
{
  const before = (await call('sync', { known: {} }, t2)).data.cfg.staff;
  await fetch(gh.url + '/repos/kaly/denah-data/contents/reset-pin.txt', { method: 'PUT', headers: { authorization: 'Bearer ' + gh.token }, body: JSON.stringify({ message: 'reset', content: btoa('lupa') }) });
  let h = await call('hello', {}, undefined, '6.6.6.6'); ok('reset-pin.txt → layar buat PIN baru', h.data.setup === false && h.data.reset === true, h.data);
  h = await call('setup', { pinStaff: '4321', pinAdmin: '87654321', staff: [] }, undefined, '6.6.6.6');
  ok('PIN baru dibuat, petugas & meja tetap', h.status === 200 && JSON.stringify(h.data.cfg.staff) === JSON.stringify(before) && h.data.cfg.tables?.length >= 42, h.data);
  ok('file reset-pin.txt terhapus', !gh.files.has('reset-pin.txt'));
  const old = await call('sync', {}, t2); ok('sesi lama ikut keluar', old.status === 401, old.status);
  ok('PIN lama tidak berlaku, PIN baru bisa', (await call('login', { pin: '2468' }, undefined, '6.6.6.7')).status === 401 && (await call('login', { pin: '87654321' }, undefined, '6.6.6.8')).data.role === 'admin');
  ok('setup biasa tetap ditolak setelah reset', (await call('setup', { pinStaff: '1111', pinAdmin: '2222' }, undefined, '6.6.6.9')).status === 403);
}
console.log(`${pass} lulus, ${fail} gagal`);
gh.close();
if (process.env.EMERG) {
  const r2 = await call('login', { pin: process.env.EMERG }, undefined, '7.7.7.7');
  console.log(r2.data.role === 'admin' ? 'PASS PIN darurat dari environment variable → admin' : 'FAIL PIN darurat ' + JSON.stringify(r2));
}
