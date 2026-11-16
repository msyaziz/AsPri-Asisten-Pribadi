# 00: Konteks Aplikasi (WAJIB DIBACA AI AGENT)

> Dokumen ini adalah ringkasan seluruh aplikasi. Baca seluruhnya sebelum menulis kode apa pun. Detail rinci ada di `prd.md`.

---

## 1. Apa produk ini?

**Asisten Pribadi Self-Hosted** milik satu orang, berjalan 24/7 di server mini (STB bekas).

- **Bot WhatsApp** (nomor cadangan) menerima chat santai dari **satu nomor utama** milik pemilik, lalu mencatat keuangan, mengatur kantong uang, menyimpan jadwal/tugas/catatan, dan menjawab pertanyaan data.
- **Web Dashboard** (laptop/PC) menampilkan rekap keuangan dan kalender, serta untuk audit dan koreksi.
- **AI (Groq, model Qwen)** hanya **menerjemahkan bahasa santai menjadi JSON** dan **merangkai jawaban**. AI bukan pengambil keputusan dan tidak punya akses langsung ke data.

Contoh: pemilik kirim `kopi 18rb` → bot mencatat pengeluaran Rp 18.000, kategori Hiburan, memotong kantong Hiburan, lalu membalas konfirmasi.

---

## 2. Pengguna dan batasan lingkungan

| Hal | Nilai |
|---|---|
| Pengguna | Satu orang (pemilik) |
| Perangkat | STB HG680p (ARM64), Armbian |
| RAM | **2 GB** (swap 8 GB hanya pengaman) |
| Disk | 300 GB HDD (hindari tulis berlebihan) |
| Bahasa produk | Indonesia, Rupiah, zona waktu **Asia/Jakarta** |
| Akses publik | Cloudflare Tunnel + Cloudflare Access |

---

## 3. ATURAN EMAS (jangan pernah dilanggar)

1. **Whitelist**: hanya pesan dari JID pemilik yang diproses. Grup, broadcast, status, dan nomor lain **dibuang tanpa balasan**.
2. **AI tidak pernah menulis SQL** dan tidak mengakses database. AI hanya memilih *intent + tool + parameter*. **Backend yang memvalidasi dan mengeksekusi.**
3. **Semua keluaran AI divalidasi dengan Zod** sebelum dipakai. Gagal validasi → tidak ada aksi.
4. **Saldo tidak disimpan sebagai angka tunggal.** Saldo selalu **dihitung** dari transaksi (view/query).
5. **Uang = `BIGINT` rupiah** (bukan float, tanpa desimal).
6. **Soft delete** (`deleted_at`) untuk semua data pengguna. Query selalu menyaring `deleted_at IS NULL`.
7. **Balasan untuk aksi tulis memakai template dari backend**, dengan angka dari database. AI tidak boleh mengarang angka.
8. **Query SQL selalu berparameter** (`$1, $2`). Tidak ada string SQL yang dibangun dari input pengguna atau AI.
9. **Satu proses Node.js** (Express + Baileys + cron) demi hemat RAM. Tanpa Redis atau message broker.
10. **Rahasia hanya di `.env`** (API key, JWT secret, DB URL). Jangan di-commit, jangan di-log.
11. **Jangan mencatat isi pesan pengguna di log aplikasi.** Catat metadata saja.
12. **Nama model AI dari variabel lingkungan** (`GROQ_TEXT_MODEL`), tidak di-hardcode. Ketersediaan model Groq sering berubah.
13. **Hanya membalas ke whitelist.** Fungsi pengirim pesan harus menolak JID non-whitelist (pagar ganda).
14. **Jangan kirim data sensitif ke AI** (PIN, OTP, password, nomor kartu/rekening panjang). Filter sebelum panggilan Groq.
15. **Aksi berisiko minta konfirmasi** (nominal besar, struk, hapus kantong, ganti uang bulanan).

---

## 4. Tech stack

| Lapisan | Pilihan |
|---|---|
| Runtime | Node.js 20 LTS, ESM (`"type": "module"`) |
| Web | Express, helmet, express-rate-limit |
| Database | PostgreSQL (disetel ringan), driver `pg` (pool maks 5) |
| WhatsApp | `@whiskeysockets/baileys` (tidak resmi), `qrcode-terminal`/`qrcode` |
| AI | Groq API (OpenAI-compatible), model teks Qwen via env |
| Validasi | `zod` |
| Waktu | `luxon` |
| Log | `pino` |
| Jadwal | `node-cron` |
| Antrean | `p-queue` |
| Gambar (fase 6) | `sharp` |
| Proses | PM2 (`max_memory_restart`) |
| Web server | Nginx (reverse proxy via aaPanel) |
| Frontend | HTML murni + Tailwind CDN + Vanilla JS (ES Modules) + Chart.js CDN, hash router (`#/`) |

---

## 5. Arsitektur

```
HP pemilik (WA utama) ──► WhatsApp ──► Nomor bot (Baileys, di STB)
                                            │
        ┌───────────────── PM2: satu proses Node.js ─────────────────┐
        │  Baileys ► Router pesan ► (regex cepat | Agent AI) ► Tools │
        │  Express API + static dashboard                            │
        │  node-cron (pengingat, briefing, tutup periode)            │
        └───────────────┬───────────────────────────┬────────────────┘
                        │                           │
                  PostgreSQL                  Disk: data/auth_info, receipts, backups
                        
Laptop ──► Cloudflare Access + Tunnel ──► Nginx ──► 127.0.0.1:3000
Bot ──► HTTPS ──► Groq API
```

Express hanya listen di `127.0.0.1`.

---

## 6. Glosarium domain

| Istilah | Arti |
|---|---|
| Periode | Satu bulan kalender (WIB), wadah transaksi dan alokasi |
| Uang bulanan | Pemasukan utama yang diinput tiap bulan |
| Saldo utama | Uang yang belum dibagi ke kantong |
| Kantong | Pembagian dari saldo utama untuk tujuan tertentu (Kebutuhan, Tabungan, ...) |
| Alokasi | Persen/nominal uang bulanan yang dipindah ke kantong |
| Rollover | Perlakuan sisa kantong saat ganti bulan: `carry` (dibawa ke kantong yang sama) atau `return` (dikembalikan ke saldo utama) |
| Pending action | Aksi yang menunggu konfirmasi `ya`/`tidak` (kedaluwarsa 10 menit) |
| Tool | Fungsi daftar putih yang boleh dipilih AI, dieksekusi backend |
| Fast-path | Perintah yang ditangani regex tanpa AI (batal, saldo, ya, ...) |
| JID/LID | Identitas WhatsApp (`...@s.whatsapp.net` / `...@lid`) |

---

## 7. Aturan keuangan (ringkas)

```
saldo_utama  = main_opening + pemasukan_ke_utama − Σ alloc_amount − pengeluaran_tanpa_kantong
               − transfer_keluar_dari_utama + transfer_masuk_ke_utama

saldo_kantong = rollover_in + alloc_amount + pemasukan_langsung + transfer_masuk
                − transfer_keluar − pengeluaran
```

- **Uang bulanan**: dicatat sebagai transaksi `masuk` (`is_monthly_income = true`, masuk saldo utama). Alokasi tiap kantong = `FLOOR(persen/100 × uang_bulanan)`. Sisa pembulatan tetap di saldo utama. Total persen ≤ 100.
- **Rollover (AKTIF)**: tiap kantong punya `rollover_mode`.
  - `carry`: sisa positif dibawa ke kantong yang sama bulan depan (`rollover_in`).
  - `return`: sisa positif dikembalikan ke saldo utama bulan depan (`main_opening`).
  - Sisa **negatif** tidak dibawa; defisitnya mengurangi `main_opening` bulan depan.
  - Sisa saldo utama juga dibawa ke `main_opening`.
  - Penutupan periode: cron tgl 1 pukul 00:05 + *lazy* saat aksi pertama di bulan baru. **Idempoten**, satu transaksi DB.
- **Konfirmasi wajib** bila: nominal ≥ Rp 1.000.000, confidence AI < 0,7, nominal AI tidak cocok dengan regex, transaksi dari foto struk, aksi destruktif.
- **Undo**: `batal` (aksi terakhir ≤ 24 jam), reply+`batal` (aksi spesifik), `ralat jadi 30rb`, `ubah kategori jadi X`. Ditangani regex, tanpa AI.
- **Kategori otomatis 3 lapis**: (1) `category_rules` → (2) AI memilih dari daftar kategori aktif → (3) tanya pengguna.

---

## 8. Model data (ringkas)

| Kelompok | Tabel |
|---|---|
| Sistem | `settings`, `admin_users`, `schema_migrations`, `bot_events`, `ai_usage_log`, `processed_messages` |
| Percakapan | `chat_history`, `pending_actions`, `action_log` |
| Keuangan | `periods`, `pockets`, `period_pockets`, `categories`, `category_rules`, `transactions`, `pocket_transfers`, `receipts`, `savings_goals`, `debts`, `recurring_bills` |
| Agenda | `events`, `reminders`, `notes` |
| View | `v_pocket_balance`, `v_main_balance` |

DDL lengkap: `prd.md` §9.3. Tabel dibuat **bertahap per fase** lewat migrasi SQL bernomor.

---

## 9. Alur pesan WhatsApp

```
messages.upsert
 1. Filter dasar: bukan 'notify' / fromMe / @g.us / status@broadcast / @newsletter → drop
 2. WHITELIST GATE: JID ternormalisasi ∈ whitelist ? lanjut : drop diam-diam
    (PAIRING_MODE=true → hanya log JID ke konsol, tanpa balas)
 3. Dedupe message_id (tabel processed_messages)
 4. Ekstrak konten: teks / caption / gambar / reply-context
 5. Rate limit lokal (30 pesan/menit)
 6. Cek pending_actions (ya / tidak / pilihan angka)
 7. Regex fast-path: batal, ralat, ubah kategori, saldo, kantong, jadwal, bantuan, ping
 8. Gambar → antrean vision (fase 6)
 9. Teks lain → Agent AI → eksekusi tool → balas
```

Balasan: presence `composing`, jeda acak 1 sampai 3 detik, simpan `bot_reply_id` ke entitas yang dibuat.

---

## 10. Desain Agent AI (ringkas)

**Pola: Understand → Validate → Execute → Respond**

1. **Understand**: Groq (temperature rendah, JSON mode) mengubah pesan + konteks (waktu WIB, kantong aktif, kategori aktif, 10 chat terakhir) menjadi `{intent, confidence, actions[], clarification}`.
2. **Validate**: Zod + aturan bisnis + cross-check nominal dengan parser Rupiah regex. Berisiko → `pending_actions`.
3. **Execute**: tool deterministik, satu transaksi DB per aksi, tulis `action_log`.
4. **Respond**: aksi tulis = template backend. Tanya data dan chat = AI merangkai kalimat dari data yang diberikan backend.

**Intent**: `catat_transaksi`, `uang_bulanan`, `atur_kantong`, `transfer_kantong`, `tambah_jadwal`, `selesai_tugas`, `catat_note`, `hutang_piutang`, `tagihan_berulang`, `target_tabungan`, `tanya_data`, `chat_biasa`, `bantuan`, `klarifikasi`.

**Mode ganda**: ngobrol biasa = bebas seperti chatbot (persona bisa diatur di `src/ai/prompts/persona.md`); mengubah data = presisi lewat tool.

**Catatan model Qwen di Groq**:
- Model Qwen 3.x terbaru di Groq bersifat multimodal (teks + gambar), mendukung tool use dan JSON mode, tetapi bisa berstatus *Preview* (dapat dihentikan sewaktu-waktu). Cek `console.groq.com/docs/models` sebelum memilih.
- Untuk chat cepat, gunakan **mode non-thinking** (cek parameter yang benar di halaman model, misalnya `reasoning_effort`), dan **buang blok `<think>...</think>`** dari keluaran bila ada.
- Karena model vision mungkin sama dengan model teks, untuk struk uji dulu model teks yang sama sebelum menambah model terpisah (`GROQ_VISION_MODEL` boleh sama dengan `GROQ_TEXT_MODEL`).

**Privasi Groq**: aktifkan **Zero Data Retention** di Groq Console → Data Controls. Baca `console.groq.com/docs/your-data`. Groq adalah pihak ketiga di cloud; kirim hanya data yang diperlukan.

---

## 11. Struktur folder final

```
asisten/
├─ docs/
│  ├─ (dokumen 00 sampai 07, prd.md)
│  └─ ui-ux/                  # TEMPAT dokumen desain UI/UX (diisi nanti)
├─ src/
│  ├─ index.js                # bootstrap
│  ├─ config/                 # env.js, constants.js
│  ├─ db/                     # pool.js, migrate.js, migrations/*.sql
│  ├─ bot/                    # connection, router, whitelist, sender, extract, regexCommands, media
│  ├─ ai/                     # groq, chat, sensitiveFilter, understand, respond, vision, schemas, prompts/
│  ├─ tools/                  # eksekutor tool tulis & baca (per domain)
│  ├─ services/               # logika bisnis: periods, pockets, transactions, transfers, rollover, ...
│  ├─ api/                    # server.js, routes/, middleware/
│  ├─ jobs/                   # cron jobs
│  └─ utils/                  # logger, jid, time, rupiah
├─ public/                    # DASHBOARD (UI/UX nanti): index.html, css/, js/{pages,components,utils}
├─ data/                      # (gitignore) auth_info/, receipts/, backups/
├─ scripts/                   # backup.sh, dll.
├─ tests/
├─ .env.example  .gitignore  ecosystem.config.cjs  package.json  README.md
```

Aturan lapisan: **bot handler dan route REST sama-sama memanggil `services/`**. Logika bisnis tidak boleh ditulis di handler bot atau route.

---

## 12. Konvensi kode

- ESM (`import/export`), `async/await`, tanpa callback.
- Identifier (variabel, tabel, kolom, fungsi) dalam **bahasa Inggris**; pesan ke pengguna dalam **bahasa Indonesia**.
- Satu file satu tanggung jawab. Hindari file > 300 baris.
- Semua input eksternal (WA, API, AI, env) divalidasi Zod.
- Error: tangkap di batas (router/route), log dengan pino (tanpa isi pesan), balas pengguna dengan pesan ramah.
- Format Rupiah: `Rp 25.000` (`Intl.NumberFormat('id-ID')`). Tanggal tampil dalam WIB.
- Parser Rupiah (`utils/rupiah.js`) menangani `25rb`, `25k`, `2,5 juta`, `1.200.000`, `500 perak`.
- Komentar kode seperlunya, jelaskan *mengapa*.
- Jangan menambah dependency tanpa alasan kuat (RAM terbatas).
- Fitur fase mendatang: file placeholder berisi komentar `// TODO(fase-N)` dan ekspor kosong. Jangan diimplementasikan lebih awal.

---

## 13. Status dan peta fase

| Fase | Fokus | Status |
|---|---|---|
| 1 | Struktur proyek, WA ↔ Groq, whitelist, chat dasar | ⏳ **Berikutnya** |
| 2 | Keuangan inti + rollover + undo | ⬜ |
| 3 | AI Agent lanjutan | ⬜ |
| 4 | Agenda + pengingat + briefing | ⬜ |
| 5 | Dashboard web + REST API | ⬜ |
| 6 | Struk, hutang, tagihan, target, grafik | ⬜ |
| 7 | Hardening + ops | ⬜ |

---

## 14. Keputusan dan asumsi (belum final, ubah di sini bila berbeda)

1. Default rollover: Kebutuhan/Tabungan/Darurat = `carry`; Hiburan = `return`.
2. Ambang konfirmasi nominal besar: Rp 1.000.000.
3. Pemasukan non-gaji masuk ke saldo utama (default).
4. Hutang/piutang hanya pencatatan (tidak mengubah saldo kantong).
5. Tagihan berulang: pengingat saja, `auto_post` default mati.
6. Struk disimpan permanen (opsi bersihkan > 12 bulan).
7. Persona bot: *(belum dipilih: santai-akrab / singkat / formal)*. Default sementara: santai-akrab.
8. Backup eksternal: *(belum dipilih)*.
