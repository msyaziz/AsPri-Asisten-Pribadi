# 05: Fase 5 — Dashboard Web + REST API (selesai & teruji di laptop)

> Lampirkan bersama `00`. Referensi: `prd.md` §13 (REST), §14 (frontend), §16 (keamanan).
> **Desain visual UI/UX belum ada.** Tulis dulu di `docs/ui-ux/`; dokumen ini hanya mengatur fungsi, data, dan keamanan.
> **Semua pekerjaan dan uji di fase ini dilakukan di laptop (`http://localhost:3000`).** Cloudflare Tunnel/Access dan pengujian di STB ditunda ke `08-deploy-ke-stb-dan-cloudflare.md`.

## 1. Tujuan
Dashboard di laptop/PC untuk memantau dan mengoreksi data, dengan login aplikasi yang aman. Hook Cloudflare Access **disiapkan di kode tetapi dimatikan** selama pengembangan lokal.

## 2. Keamanan (dikerjakan dulu, semua bisa diuji lokal)
1. **Autentikasi aplikasi**: `admin_users` (bcryptjs), JWT di cookie httpOnly + SameSite=Strict (12 jam), rate limit login (5 per 15 menit), cek `Origin` untuk metode ubah-data, helmet + CSP (izinkan CDN yang dipakai).
2. **Flag cookie `Secure` bisa diatur**: `COOKIE_SECURE=false` untuk lokal, `true` untuk produksi. (Beberapa browser menolak cookie `Secure` di `http://`.)
3. **Hook Cloudflare Access (nonaktif di lokal)**: middleware verifikasi header `Cf-Access-Jwt-Assertion` yang aktif hanya bila `CF_ACCESS_ENABLED=true`. Default `false`. Kodenya ditulis dan diuji dengan **JWT tiruan** (lihat bagian 6), sehingga di Fase 8 tinggal menyalakan flag dan mengisi `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD`.
4. **Jangan membuka laptop ke internet** (ngrok, port forwarding, dsb.) hanya untuk menguji dashboard. Login aplikasi bukan pengganti Cloudflare Access untuk akses publik.

Variabel baru di `.env`:
```
COOKIE_SECURE=false
CF_ACCESS_ENABLED=false
CF_ACCESS_TEAM_DOMAIN=
CF_ACCESS_AUD=
JWT_SECRET=ganti_dengan_string_acak_panjang
ADMIN_EMAIL=you@example.com
```
Akun admin pertama dibuat lewat skrip `npm run create-admin` (minta email dan password, simpan hash bcrypt). Jangan ada password bawaan.

## 3. REST API
Implementasikan sesuai `prd.md` §13: auth, summary, periods (termasuk close dan recompute), pockets, allocations, transactions (filter, edit, hapus/pulihkan), transfers, categories dan rules, events, notes, laporan, export CSV, pending, action-log, ai-usage, settings, bot status (+ QR hanya saat pairing dan hanya terautentikasi). Respons seragam `{ ok, data | error }`, validasi Zod di setiap rute, **route memanggil `services/`** (bukan menulis logika sendiri).

## 4. Halaman (route hash)
`#/login`, `#/` (ringkasan), `#/transaksi`, `#/kantong`, `#/kalender`, `#/catatan`, `#/kategori`, `#/bot`, `#/log`, `#/pengaturan`. Data dan fungsi per halaman: `prd.md` §14. Struktur kode: `public/js/{app,router,api,state}.js`, `pages/`, `components/`, `utils/format.js`.

Ketentuan teknis (non-visual): format `Intl.NumberFormat('id-ID')`, tanggal WIB, umpan balik sukses/gagal untuk aksi tulis, konfirmasi untuk aksi destruktif, paginasi server-side (50), **escape semua data yang dimasukkan ke HTML (anti-XSS)**, penanganan 401 (arahkan ke login).

## 5. Langkah kerja
1. Auth + `create-admin` + middleware keamanan + tes (tanpa cookie → 401). **✅ A.**
2. Hook Cloudflare Access (nonaktif) + unit test JWT tiruan. **✅ B.**
3. API ringkasan, transaksi, kantong, periode. **✅ C:** angka sama dengan balasan bot.
4. API agenda, kategori, bot, log, settings. **✅ D.**
5. Frontend: kerangka (router, api.js), lalu halaman satu per satu: Beranda → Transaksi → Kantong → Kalender → sisanya. **✅ E** per halaman.
6. Export CSV (UTF-8 BOM). Setelah desain UI/UX tersedia, terapkan ke `public/`.

## 6. Uji lokal pengganti Cloudflare
| Yang ingin dibuktikan | Cara uji di laptop |
|---|---|
| API terkunci tanpa login | `curl -i http://localhost:3000/api/summary` → `401` |
| Login berhasil/gagal, rate limit | 6 kali login salah → percobaan ke-6 diblokir |
| Metode ubah-data menolak `Origin` asing | `curl -X POST ... -H "Origin: http://evil.test"` dengan cookie valid → ditolak |
| Verifikasi JWT Cloudflare benar | Unit test: buat pasangan kunci RSA + JWKS tiruan, tandatangani token. Token valid → lolos; kedaluwarsa, `aud` salah, atau tanda tangan salah → `403` |
| Flag mati tidak mengganggu | `CF_ACCESS_ENABLED=false` → request tanpa header tetap bisa login aplikasi |
| Flag hidup menutup akses | `CF_ACCESS_ENABLED=true` tanpa header → `403` (diuji dengan konfigurasi tiruan) |

## 7. Definisi Selesai (versi laptop)
- [x] Tanpa login, semua `/api/*` (kecuali health/login) → 401.
- [x] Rate limit login dan cek `Origin` teruji.
- [x] Middleware Cloudflare Access lolos semua unit test JWT tiruan, dan **default mati**.
- [x] Angka dashboard = angka balasan bot (sumber sama: view/service).
- [x] Hapus/pulihkan transaksi di dashboard memperbarui saldo.
- [x] Edit transaksi di periode tertutup memicu `recompute` berantai dan hasilnya benar.
- [x] Tidak ada rahasia/QR bocor di respons yang tidak terautentikasi.
- [x] Semua halaman bisa dibuka di `http://localhost:3000`.

> Yang **tidak** dibuktikan di fase ini (dipindah ke Fase 8): domain publik, Cloudflare Tunnel, Cloudflare Access sungguhan, cookie `Secure` di HTTPS, Nginx.

## 8. Catatan untuk AI agent
Jangan menambah framework frontend/bundler. Jangan menunda keamanan ke akhir. Jangan menghidupkan `CF_ACCESS_ENABLED` di lokal. Lanjut ke `06-fase6-fitur-lanjutan.md`.
