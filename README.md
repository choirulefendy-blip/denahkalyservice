# Kaly Denah Service

Aplikasi terpisah untuk tim service Kaly Eatery: mencatat **tamu datang, tamu pulang, dan catatan per meja** di denah Kaly Eatery. Admin bisa **menambah, memindah, dan menghapus meja** (Atur meja).

Data tersimpan di **Netlify Blobs** (store `kaly-denah`), tidak memakai Supabase dan tidak mengubah data Kaly Ops.

| Folder / file | Isi |
|---|---|
| `public/` | Halaman aplikasi (HTML, CSS, JavaScript tanpa build). `tables.js` = daftar 42 meja bawaan & ukuran gambar denah, `assets/denah.png` = gambar denah. |
| `netlify/functions/api.mjs` | Server kecil `/api/*` yang siap pakai (hasil bundel dari `src/api.mjs`). **Jangan diedit langsung.** |
| `src/api.mjs` | Sumber server API. Setelah diubah, bundel ulang: `cd dev && npm install && cd .. && node dev/build.mjs` |
| `dev/` | Alat uji lokal: `node dev/server.mjs` (aplikasi + API + Blobs lokal di http://localhost:8888) dan `node dev/api_test.mjs` |
| `netlify.toml` | Pengaturan Netlify (folder `public`, fungsi di `netlify/functions`) |
| `BACA-DULU.txt` | Cara memasang & memakai untuk Owner dan tim service |

## Terbit ke Netlify dari GitHub

1. Netlify › **Add new project › Import an existing project › GitHub** › pilih `choirulefendy-blip/denahkalyservice`.
2. Build command: **kosongkan**. Publish directory: `public` (sudah diatur `netlify.toml`). Deploy.
3. Bila memakai project lama **kaly-denah**: Project configuration › Build & deploy › Link repository, supaya data tamu & PIN yang sudah ada tetap dipakai (Blobs melekat pada project, bukan pada repository).

Setiap push ke `main` terbit otomatis dan memakai **15 kredit** Netlify (paket gratis: 300 kredit/bulan untuk semua project). Gabungkan beberapa perubahan dalam satu push supaya hemat.

## Atur meja

Layar Denah › **Atur meja** (PIN admin): ketuk tempat kosong untuk menambah meja, seret meja untuk memindah, ketuk meja untuk mengubah atau menghapus. Daftar meja hasil ubahan disimpan di server (config `tables`) dan menggantikan daftar bawaan di `public/tables.js` untuk semua perangkat.
