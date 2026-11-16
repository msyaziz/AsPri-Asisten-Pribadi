/**
 * Scheduler Cron Jobs (node-cron).
 * Sesuai prd.md §8.4, §15, 02-fase2-keuangan-inti.md, 04-fase4-agenda.md.
 */

import cron from 'node-cron';
import { pool } from '../db/pool.js';
import { nowWib } from '../utils/time.js';
import { ensurePreviousPeriodsClosed, formatRolloverSummary } from '../services/rollover.js';
import { expandRecurrences } from '../services/events.js';
import { sendText } from '../bot/sender.js';
import { logger } from '../utils/logger.js';
import { CONSTANTS } from '../config/constants.js';
import { runReminderJob } from './reminders.js';
import { runDailyBriefing, runWeeklyReport } from './briefing.js';
import { expirePendingActions } from '../services/pendingActions.js';

const TZ = CONSTANTS.TIMEZONE;

// Menyimpan referensi semua cron task agar bisa dihentikan
const cronTasks = [];

/**
 * Ambil target JID dari settings DB.
 * @returns {Promise<string|null>}
 */
async function getTargetJid() {
  try {
    const res = await pool.query("SELECT value FROM settings WHERE key = 'whitelist_jid'");
    if (res.rowCount === 0) return null;
    const raw = res.rows[0].value;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed[0] : parsed;
    } catch {
      return raw.replace(/"/g, '');
    }
  } catch {
    return null;
  }
}

/**
 * Inisialisasi semua job terjadwal.
 * - Tutup buku: tgl 1, 00:05
 * - Reminder: setiap menit
 * - Recurrence expand: setiap hari 00:10
 * - Daily briefing: setiap hari 07:00 (dari settings)
 * - Weekly report: Minggu 20:00 (dari settings)
 * - Pending expire: setiap 5 menit
 * - Cleanup: setiap hari 03:00
 * - Heartbeat: setiap 5 menit
 */
export function initJobs() {
  if (cronTasks.length > 0) return;

  // 1. Tutup buku & rollover bulanan
  cronTasks.push(
    cron.schedule(
      '5 0 1 * *',
      async () => {
        logger.info('Menjalankan cron job penutupan periode & rollover bulanan...');
        try {
          const dt = nowWib();
          const closedList = await ensurePreviousPeriodsClosed(dt.year, dt.month);
          if (closedList.length > 0) {
            logger.info({ closedCount: closedList.length }, 'Penutupan periode otomatis berhasil.');
            const targetJid = await getTargetJid();
            if (targetJid) {
              for (const summary of closedList) {
                try {
                  await sendText(targetJid, formatRolloverSummary(summary));
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
      { timezone: TZ }
    )
  );

  // 2. Reminder – setiap menit
  cronTasks.push(
    cron.schedule(
      '* * * * *',
      async () => {
        try {
          const jid = await getTargetJid();
          if (jid) await runReminderJob(jid);
        } catch (err) {
          logger.warn({ err: err.message }, 'Error reminder job');
        }
      },
      { timezone: TZ }
    )
  );

  // 3. Ekspansi recurrence harian – 00:10
  cronTasks.push(
    cron.schedule(
      '10 0 * * *',
      async () => {
        try {
          await expandRecurrences(30);
          logger.info('Recurrence expansion selesai.');
        } catch (err) {
          logger.warn({ err: err.message }, 'Error recurrence expand job');
        }
      },
      { timezone: TZ }
    )
  );

  // 4. Daily briefing – 07:00 WIB
  cronTasks.push(
    cron.schedule(
      '0 7 * * *',
      async () => {
        try {
          await runDailyBriefing();
        } catch (err) {
          logger.warn({ err: err.message }, 'Error daily briefing job');
        }
      },
      { timezone: TZ }
    )
  );

  // 5. Weekly report – Minggu 20:00 WIB
  cronTasks.push(
    cron.schedule(
      '0 20 * * 0',
      async () => {
        try {
          await runWeeklyReport();
        } catch (err) {
          logger.warn({ err: err.message }, 'Error weekly report job');
        }
      },
      { timezone: TZ }
    )
  );

  // 6. Pending expire – setiap 5 menit
  cronTasks.push(
    cron.schedule(
      '*/5 * * * *',
      async () => {
        try {
          await expirePendingActions();
        } catch (err) {
          logger.warn({ err: err.message }, 'Error pending expire job');
        }
      },
      { timezone: TZ }
    )
  );

  // 7. Cleanup harian – 03:00
  cronTasks.push(
    cron.schedule(
      '0 3 * * *',
      async () => {
        try {
          // Hapus processed_messages lebih dari 7 hari
          await pool.query(
            `DELETE FROM processed_messages WHERE created_at < now() - interval '7 days'`
          );
          // Soft-delete notes lebih dari 90 hari yang sudah deleted_at
          await pool.query(
            `DELETE FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '90 days'`
          );
          logger.info('Cleanup job selesai.');
        } catch (err) {
          logger.warn({ err: err.message }, 'Error cleanup job');
        }
      },
      { timezone: TZ }
    )
  );

  // 8. Heartbeat – setiap 5 menit (cek koneksi WA)
  cronTasks.push(
    cron.schedule(
      '*/5 * * * *',
      async () => {
        try {
          // Ambil timestamp koneksi terakhir dari settings
          const res = await pool.query(
            "SELECT value FROM settings WHERE key = 'wa_last_connected'"
          );
          if (res.rowCount > 0) {
            const lastConnected = new Date(res.rows[0].value);
            const diffMin = (Date.now() - lastConnected.getTime()) / 60000;
            if (diffMin > 10) {
              logger.warn({ diffMin: Math.floor(diffMin) }, 'WA disconnected > 10 menit');
            }
          }
        } catch (err) {
          logger.warn({ err: err.message }, 'Error heartbeat job');
        }
      },
      { timezone: TZ }
    )
  );

  logger.info(
    `Cron job scheduler diinisialisasi: ${cronTasks.length} job aktif (tutup buku, reminder, recurrence, briefing, weekly-report, pending-expire, cleanup, heartbeat).`
  );
}

/**
 * Menghentikan semua cron job aktif (graceful shutdown).
 */
export function stopJobs() {
  for (const task of cronTasks) {
    task.stop();
  }
  cronTasks.length = 0;
  logger.info('Semua cron job dihentikan.');
}

export default { initJobs, stopJobs };
