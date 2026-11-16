/**
 * Job: Daily Briefing & Weekly Report untuk Fase 4.
 * Sesuai prd.md §8.11, §15
 */

import { pool } from '../db/pool.js';
import { sendText } from '../bot/sender.js';
import { logger } from '../utils/logger.js';
import { nowWib, formatWib } from '../utils/time.js';

/**
 * Ambil target JID dari settings.
 * @returns {Promise<string|null>}
 */
async function getTargetJid() {
  const res = await pool.query("SELECT value FROM settings WHERE key = 'whitelist_jid'");
  if (res.rowCount === 0) return null;
  const raw = res.rows[0].value;
  // Value bisa berupa JSON string atau plain string
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed[0] : parsed;
  } catch {
    return raw.replace(/"/g, '');
  }
}

/**
 * Briefing harian: jadwal hari ini + tugas open.
 * Dipanggil cron jam 07:00 WIB.
 */
export async function runDailyBriefing() {
  const jid = await getTargetJid();
  if (!jid) return;

  const dt = nowWib();
  const todayStr = dt.toFormat('yyyy-MM-dd');
  const dayLabel = dt.setLocale('id-ID').toFormat('EEEE, d LLLL yyyy');

  // Events hari ini
  const evRes = await pool.query(
    `SELECT title, starts_at, kind
     FROM events
     WHERE DATE(starts_at AT TIME ZONE 'Asia/Jakarta') = $1
       AND status = 'open'
     ORDER BY starts_at ASC`,
    [todayStr]
  );

  // Tasks open (tanpa tanggal atau jatuh tempo hari ini)
  const taskRes = await pool.query(
    `SELECT title, starts_at
     FROM events
     WHERE kind = 'task'
       AND status = 'open'
       AND (DATE(starts_at AT TIME ZONE 'Asia/Jakarta') <= $1)
     ORDER BY starts_at ASC LIMIT 10`,
    [todayStr]
  );

  // Saldo kantong
  const pocketRes = await pool.query(
    `SELECT p.name, COALESCE(SUM(
        CASE WHEN t.type='masuk' THEN t.amount ELSE -t.amount END
     ), 0) AS balance
     FROM pockets p
     LEFT JOIN transactions t ON t.pocket_id = p.id AND t.deleted_at IS NULL
     WHERE p.is_active = TRUE
     GROUP BY p.name
     ORDER BY p.name`
  );

  let lines = [`*📋 Briefing Harian – ${dayLabel}*\n`];

  if (evRes.rowCount > 0) {
    lines.push('*📅 Jadwal Hari Ini:*');
    for (const ev of evRes.rows) {
      const time = formatWib(ev.starts_at, 'HH:mm');
      lines.push(`• ${time} – ${ev.title}`);
    }
  } else {
    lines.push('📅 Tidak ada jadwal hari ini.');
  }

  if (taskRes.rowCount > 0) {
    lines.push('\n*📌 Tugas Aktif:*');
    for (const t of taskRes.rows) {
      lines.push(`• ${t.title}`);
    }
  }

  if (pocketRes.rowCount > 0) {
    lines.push('\n*💰 Saldo Kantong:*');
    for (const p of pocketRes.rows) {
      const bal = Number(p.balance);
      lines.push(`• ${p.name}: Rp ${bal.toLocaleString('id-ID')}`);
    }
  }

  const msg = lines.join('\n');
  try {
    await sendText(jid, msg);
    logger.info('Daily briefing terkirim.');
  } catch (err) {
    logger.warn({ err: err.message }, 'Gagal kirim daily briefing');
  }
}

/**
 * Laporan mingguan: ringkasan 7 hari.
 * Dipanggil cron Minggu 20:00 WIB.
 */
export async function runWeeklyReport() {
  const jid = await getTargetJid();
  if (!jid) return;

  const dt = nowWib();
  const toDate = dt.toFormat('yyyy-MM-dd');
  const fromDate = dt.minus({ days: 6 }).toFormat('yyyy-MM-dd');

  const spendRes = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM transactions
     WHERE type = 'keluar'
       AND deleted_at IS NULL
       AND tx_date BETWEEN $1 AND $2`,
    [fromDate, toDate]
  );

  const incRes = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM transactions
     WHERE type = 'masuk'
       AND deleted_at IS NULL
       AND tx_date BETWEEN $1 AND $2`,
    [fromDate, toDate]
  );

  const totalSpend = Number(spendRes.rows[0].total);
  const totalInc = Number(incRes.rows[0].total);

  const msg =
    `*📊 Laporan Mingguan*\n` +
    `Periode: ${fromDate} s.d. ${toDate}\n\n` +
    `• Pemasukan: Rp ${totalInc.toLocaleString('id-ID')}\n` +
    `• Pengeluaran: Rp ${totalSpend.toLocaleString('id-ID')}\n` +
    `• Selisih: Rp ${(totalInc - totalSpend).toLocaleString('id-ID')}`;

  try {
    await sendText(jid, msg);
    logger.info('Weekly report terkirim.');
  } catch (err) {
    logger.warn({ err: err.message }, 'Gagal kirim weekly report');
  }
}

export default { runDailyBriefing, runWeeklyReport };

