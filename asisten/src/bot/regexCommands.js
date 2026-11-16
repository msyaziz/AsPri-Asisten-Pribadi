/**
 * Penangan Perintah Cepat Berbasis Regex (Fast-path tanpa AI).
 * Sesuai prd.md §8.8, §11 dan 02-fase2-keuangan-inti.md.
 */

import { pool } from '../db/pool.js';
import { ensureCurrentPeriod, getMainBalance, getTotalMoney } from '../services/periods.js';
import { getPocketBalances, setRolloverMode, getPocketByName } from '../services/pockets.js';
import { getLastUndoableAction, undoAction, reviseLastTransaction } from '../services/undo.js';
import { learnFromCorrection } from '../services/categories.js';
import { formatRupiah, parseRupiah } from '../utils/rupiah.js';
import { nowWib, formatWib } from '../utils/time.js';

/**
 * Format detik menjadi teks waktu ringkas.
 * @param {number} seconds
 * @returns {string}
 */
function formatUptime(seconds) {
  const sec = Math.floor(seconds);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;

  const parts = [];
  if (h > 0) parts.push(`${h} jam`);
  if (m > 0) parts.push(`${m} menit`);
  parts.push(`${s} detik`);

  return parts.join(' ');
}

/**
 * Memeriksa dan mengeksekusi perintah cepat berbasis regex (fast-path tanpa AI).
 * @param {string} text
 * @param {object} [context={}]
 * @param {string|null} [context.quotedStanzaId]
 * @returns {Promise<string|null>} Balasan teks atau null jika bukan perintah regex
 */
export async function handleRegexCommand(text, context = {}) {
  if (!text || typeof text !== 'string') return null;
  const raw = text.trim();
  const normalized = raw.toLowerCase();

  // 1. Perintah: ping
  if (normalized === 'ping') {
    const uptimeStr = formatUptime(process.uptime());
    return `pong 🏓\nUptime: ${uptimeStr}`;
  }

  // 2. Perintah: reset
  if (normalized === 'reset') {
    try {
      await pool.query('DELETE FROM chat_history');
      return 'Riwayat obrolan dibersihkan.';
    } catch {
      return 'Gagal membersihkan riwayat obrolan. Coba lagi nanti ya.';
    }
  }

  // 3. Perintah: bantuan atau menu
  if (normalized === 'bantuan' || normalized === 'menu') {
    return (
      `*Halo! Aku AsPri (Asisten Pribadi)* 🤖\n\n` +
      `*Fitur Keuangan (Fase 2):*\n` +
      `• *Catat Pengeluaran*: "kopi 18rb", "bensin 25.000", "listrik 150rb"\n` +
      `• *Uang Bulanan*: "uang bulanan 3 juta" atau "gaji masuk 5jt"\n` +
      `• *Atur Alokasi*: "bagi 50% kebutuhan, 20% tabungan, 30% hiburan"\n` +
      `• *Transfer Dana*: "pindah 100rb dari hiburan ke kebutuhan"\n` +
      `• *Cek Saldo*: ketik *saldo* atau *kantong*\n` +
      `• *Batalkan Aksi*: ketik *batal* atau reply pesan bot lalu ketik *batal*\n` +
      `• *Ralat Nominal*: "ralat jadi 30rb"\n` +
      `• *Mode Rollover*: "rollover tabungan dibawa" atau "rollover hiburan balik"\n\n` +
      `*Fitur Agenda & Catatan (Fase 4):*\n` +
      `• *Jadwal*: ketik *jadwal* untuk cek agenda mendatang\n` +
      `• *Hari Ini*: ketik *hari ini* untuk ringkasan hari ini\n` +
      `• *Tambah Jadwal/Tugas*: "rapat jam 14 besok", "tugas laporan deadline jumat"\n` +
      `• *Tugas Selesai*: "selesai tugas laporan"\n` +
      `• *Catatan*: "catat password wifi abc123", "cari catatan servis motor"\n\n` +
      `*Perintah Sistem:*\n` +
      `• *ping*: Cek status bot & uptime\n` +
      `• *reset*: Bersihkan memori percakapan\n` +
      `• *bantuan*: Tampilkan menu ini`
    );
  }

  // 4. Perintah: saldo atau kantong
  if (normalized === 'saldo' || normalized === 'kantong' || normalized === 'cek saldo') {
    const currentPeriod = await ensureCurrentPeriod();
    const mainBal = await getMainBalance(currentPeriod.id);
    const pockets = await getPocketBalances(currentPeriod.id);
    const totalMoney = await getTotalMoney(currentPeriod.id);

    const pocketLines = pockets.map((p) => {
      let line = `• *${p.pocketName}*: ${formatRupiah(p.balance)}`;
      if (p.balance < 0n) line += ' ⚠️ *(minus)*';
      return line;
    });

    return (
      `📊 *Ringkasan Saldo Saat Ini* (${currentPeriod.month}/${currentPeriod.year})\n\n` +
      `🏦 *Saldo Utama:* ${formatRupiah(mainBal)}\n\n` +
      `*Kantong:*\n` +
      (pocketLines.length > 0 ? pocketLines.join('\n') : '• (Belum ada kantong)') +
      `\n\n💰 *Total Uang:* ${formatRupiah(totalMoney.grandTotal)}`
    );
  }

  // 4b. Perintah: jadwal atau agenda
  if (normalized === 'jadwal' || normalized === 'agenda') {
    const evRes = await pool.query(
      `SELECT title, starts_at, kind, status
       FROM events
       WHERE deleted_at IS NULL
         AND status = 'open'
         AND starts_at >= now() - interval '1 hour'
       ORDER BY starts_at ASC
       LIMIT 10`
    );

    if (evRes.rowCount === 0) {
      return '📅 Belum ada jadwal atau tugas mendatang.';
    }

    const lines = ['*📅 Jadwal & Tugas Mendatang:*\n'];
    for (const ev of evRes.rows) {
      const timeStr = formatWib(ev.starts_at, 'dd LLL, HH:mm');
      const icon = ev.kind === 'task' ? '📌' : '🗓️';
      lines.push(`${icon} ${timeStr} – *${ev.title}*`);
    }
    return lines.join('\n');
  }

  // 4c. Perintah: hari ini
  if (normalized === 'hari ini' || normalized === 'today') {
    const dt = nowWib();
    const today = dt.toFormat('yyyy-MM-dd');
    const dayLabel = dt.setLocale('id-ID').toFormat('EEEE, d LLLL yyyy');

    const evRes = await pool.query(
      `SELECT title, starts_at, kind
       FROM events
       WHERE deleted_at IS NULL
         AND status = 'open'
         AND DATE(starts_at AT TIME ZONE 'Asia/Jakarta') = $1
       ORDER BY starts_at ASC`,
      [today]
    );

    const taskRes = await pool.query(
      `SELECT title FROM events
       WHERE deleted_at IS NULL
         AND kind = 'task'
         AND status = 'open'
       ORDER BY starts_at ASC LIMIT 5`
    );

    const spendRes = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM transactions
       WHERE deleted_at IS NULL
         AND type = 'keluar'
         AND tx_date = $1`,
      [today]
    );

    const lines = [`*📋 Ringkasan Hari Ini – ${dayLabel}*\n`];

    if (evRes.rowCount > 0) {
      lines.push('*📅 Jadwal Hari Ini:*');
      for (const ev of evRes.rows) {
        lines.push(`• ${formatWib(ev.starts_at, 'HH:mm')} – ${ev.title}`);
      }
    } else {
      lines.push('📅 Tidak ada jadwal untuk hari ini.');
    }

    if (taskRes.rowCount > 0) {
      lines.push('\n*📌 Tugas Aktif:*');
      for (const t of taskRes.rows) {
        lines.push(`• ${t.title}`);
      }
    }

    const spendTotal = Number(spendRes.rows[0].total);
    lines.push(`\n💸 *Pengeluaran Hari Ini:* ${formatRupiah(spendTotal)}`);

    return lines.join('\n');
  }

  // 5. Perintah: batal / undo / hapus yang tadi
  if (
    normalized === 'batal' ||
    normalized === 'undo' ||
    normalized === 'batalin' ||
    normalized === 'hapus yang tadi'
  ) {
    const undoable = await getLastUndoableAction({
      botReplyId: context.quotedStanzaId || null,
      windowHours: 24,
    });

    if (!undoable) {
      return 'Tidak ada aksi dalam 24 jam terakhir yang dapat dibatalkan.';
    }

    try {
      const res = await undoAction(undoable.id);

      let desc = 'Aksi terakhir';
      let extra = '';
      if (res.entity === 'transaction') {
        desc = res.undoneAction === 'create' ? 'Transaksi' : 'Penghapusan transaksi';
        const currentPeriod = await ensureCurrentPeriod();
        const total = await getTotalMoney(currentPeriod.id);
        extra = `\nSaldo telah dipulihkan. Total uang saat ini: ${formatRupiah(total.grandTotal)}.`;
      } else if (res.entity === 'transfer') {
        desc = 'Transfer';
        const currentPeriod = await ensureCurrentPeriod();
        const total = await getTotalMoney(currentPeriod.id);
        extra = `\nSaldo telah dipulihkan. Total uang saat ini: ${formatRupiah(total.grandTotal)}.`;
      } else if (res.entity === 'event') {
        desc = res.undoneAction === 'create' ? 'Jadwal / tugas' : 'Penyelesaian tugas';
      } else if (res.entity === 'note') {
        desc = 'Catatan';
      }

      return `✅ ${desc} berhasil dibatalkan.${extra}`;
    } catch (err) {
      return `Gagal membatalkan aksi: ${err.message}`;
    }
  }

  // 6. Perintah: ralat jadi X
  const ralatMatch = normalized.match(/^ralat\s+(?:jadi\s+)?(.+)$/i);
  if (ralatMatch) {
    const targetAmountStr = ralatMatch[1].trim();
    const newAmount = parseRupiah(targetAmountStr);
    if (!newAmount || newAmount <= 0) {
      return `Format nominal ralat tidak valid: "${targetAmountStr}". Contoh: "ralat jadi 30rb".`;
    }

    try {
      const { previous, updated } = await reviseLastTransaction({ amount: newAmount });
      return (
        `✅ Transaksi terakhir berhasil diralat!\n` +
        `• Nominal lama: ${formatRupiah(previous.amount)}\n` +
        `• Nominal baru: ${formatRupiah(updated.amount)}`
      );
    } catch (err) {
      return `Gagal meralat transaksi: ${err.message}`;
    }
  }

  // 7. Perintah: ubah kategori jadi X
  const ubahKatMatch = normalized.match(/^ubah\s+kategori\s+(?:jadi\s+)?(.+)$/i);
  if (ubahKatMatch) {
    const targetCat = ubahKatMatch[1].trim();
    const catRes = await pool.query(
      'SELECT id, name, default_pocket_id FROM categories WHERE LOWER(name) = LOWER($1)',
      [targetCat]
    );
    if (catRes.rows.length === 0) {
      return `Kategori "${targetCat}" tidak ditemukan.`;
    }

    const cat = catRes.rows[0];
    try {
      const { updated, previous } = await reviseLastTransaction({
        categoryId: cat.id,
        pocketId: cat.default_pocket_id,
      });

      // Belajar dari koreksi pengguna (Fase 3 Checkpoint A & prd.md §8.9)
      const noteToLearn = updated.note || previous?.note;
      if (noteToLearn) {
        await learnFromCorrection({ text: noteToLearn, categoryId: cat.id });
      }

      return `✅ Kategori transaksi #${updated.id} berhasil diubah menjadi *${cat.name}*.`;
    } catch (err) {
      return `Gagal mengubah kategori: ${err.message}`;
    }
  }

  // 8. Perintah: rollover <kantong> dibawa / balik
  const rolloverMatch = normalized.match(/^rollover\s+(.+?)\s+(dibawa|balik(?:\s+ke\s+utama)?)$/i);
  if (rolloverMatch) {
    const pocketName = rolloverMatch[1].trim();
    const direction = rolloverMatch[2].startsWith('dibawa') ? 'carry' : 'return';

    try {
      const updated = await setRolloverMode(pocketName, direction);
      const desc = direction === 'carry' ? 'dibawa ke bulan depan (carry)' : 'dikembalikan ke Saldo Utama (return)';
      return `✅ Mode rollover kantong *${updated.name}* diatur ke *${desc}*.`;
    } catch (err) {
      return `Gagal mengatur rollover: ${err.message}`;
    }
  }

  return null;
}

export default handleRegexCommand;
