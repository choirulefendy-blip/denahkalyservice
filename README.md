# Kaly Denah Service

Buku tamu meja untuk tim service Kaly Eatery: **tamu datang, tamu pulang, catatan per meja**, dan **Atur meja** (tambah/pindah/hapus meja, PIN admin). **Sepenuhnya di GitHub**, tanpa server:

- **Halaman**: GitHub Pages dari repository ini → https://choirulefendy-blip.github.io/denahkalyservice/
- **Data**: repository **privat** `choirulefendy-blip/denahkalyservice-data`, ditulis langsung dari browser lewat GitHub API dengan kunci (fine-grained token) yang dimasukkan admin di tiap perangkat. Setiap catatan = satu file JSON; tulis bersyarat memakai `sha` supaya dua tablet tidak bisa mengisi meja yang sama.

Cara memasang & memakai: lihat **BACA-DULU.txt**.

| Folder / file | Isi |
|---|---|
| `public/` | Aplikasi (HTML, CSS, JavaScript tanpa build). Diterbitkan ke GitHub Pages oleh `.github/workflows/pages.yml`. |
| `public/backend.js` | Aturan aplikasi (kunci meja, PIN staf/admin, riwayat, ekspor CSV, Atur meja) yang berjalan di browser. |
| `public/github.js` | Penyimpanan di repository GitHub privat (contents API, tulis bersyarat, antrean tulis). |
| `public/tables.js` | 42 meja bawaan & ukuran gambar denah (`public/assets/denah.png`). |
| `dev/` | Uji lokal tanpa internet: `node dev/server.mjs` (aplikasi + tiruan GitHub API), `node dev/backend_test.mjs` (54 uji; `RACE=0.25` untuk mensimulasikan tulis bersamaan). |
| `index.html` | Pengalih ke `public/` (bila Pages diatur dari branch). |

**Jangan pernah** menaruh kunci GitHub di repository ini (repository publik). Workflow terbit menolak bila ada.
