/**
 * Scheduler Cron Jobs (node-cron).
 * Sesuai prd.md §8.4, §15 dan 02-fase2-keuangan-inti.md.
 */

import cron from 'node-cron';
import { pool } from '../db/pool.js';
import { nowWib } from '../utils/time.js';
import { ensurePreviousPeriodsClosed, formatRolloverSummary } from '../services/rollover.js';
import { sendText } from '../bot/sender.js';
import { logger } from '../utils/logger.js';
import { CONSTANTS } from '../config/constants.js';

let cronTask = null;

/**
 * Inisialisasi job terjadwal untuk penutupan periode (tutup buku & rollover).
 * Berjalan setiap tanggal 1 pukul 00:05 WIB.
 */
export function initJobs() {
  if (cronTask) return;

  // Jadwal: Menit 5, Jam 0, Hari 1 tiap bulan
  cronTask = cron.schedule(
    '5 0 1 * *',
    async () => {
      logger.info('Menjalankan cron job penutupan periode & rollover bulanan...');
      try {
        const dt = nowWib();
        const closedList = await ensurePreviousPeriodsClosed(dt.year, dt.month);

        if (closedList.length > 0) {
          logger.info({ closedCount: closedList.length }, 'Penutupan periode otomatis berhasil.');

          // Ambil whitelist_jid untuk mengirimkan notifikasi ringkasan
          const settingsRes = await pool.query(
            "SELECT value FROM settings WHERE key = 'whitelist_jid'"
          );
          const rawJid = settingsRes.rows[0]?.value;
          const targetJid = typeof rawJid === 'string' ? rawJid.replace(/"/g, '') : null;

          if (targetJid) {
            for (const summary of closedList) {
              const text = formatRolloverSummary(summary);
              try {
                await sendText(targetJid, text);
              } catch (err) {
                logger.warn({ err: err.message }, 'Gagal mengirim ringkasan rollover ke WA');
              }
            }
          }
        }
      } catch (err) {
        logger.error({ err: err.message }, 'Error saat menjalankan cron penutupan periode');
      }
    },
    {
      timezone: CONSTANTS.TIMEZONE,
    }
  );

  logger.info('Cron job scheduler diinisialisasi (tutup buku tgl 1, 00:05 WIB).');
}

/**
 * Menghentikan semua cron job aktif (graceful shutdown).
 */
export function stopJobs() {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logger.info('Cron job scheduler dihentikan.');
  }
}

export default { initJobs, stopJobs };
