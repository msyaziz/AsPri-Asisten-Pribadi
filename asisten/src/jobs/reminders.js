/**
 * Job helper: membuat entri reminders untuk sebuah event.
 * Dipanggil dari services/events.js (createReminders).
 * File ini diekspor juga untuk penggunaan langsung di scheduler.
 * Fase 4 – prd.md §8.11, §15
 */

import { pool } from '../db/pool.js';
import { sendText } from '../bot/sender.js';
import { logger } from '../utils/logger.js';
import { formatWib } from '../utils/time.js';

/**
 * Tambah entri reminders untuk event tertentu.
 * @param {number} eventId
 * @param {Date|string} startsAt
 * @param {number[]} offsetsMinutes - menit sebelum event
 */
export async function addRemindersForEvent(eventId, startsAt, offsetsMinutes) {
  const start = new Date(typeof startsAt === 'string' ? startsAt : startsAt.toISOString());
  for (const offsetMin of offsetsMinutes) {
    const remindAt = new Date(start.getTime() - offsetMin * 60 * 1000);
    if (remindAt <= new Date()) continue;
    await pool.query(
      `INSERT INTO reminders (event_id, remind_at, offset_minutes)
       VALUES ($1, $2, $3)
       ON CONFLICT (event_id, offset_minutes) DO NOTHING`,
      [eventId, remindAt.toISOString(), offsetMin]
    );
  }
}

/**
 * Jalankan proses pengiriman reminders yang sudah jatuh tempo.
 * Dipanggil oleh cron setiap menit.
 * @param {string} targetJid - WhatsApp JID tujuan notifikasi
 */
export async function runReminderJob(targetJid) {
  const due = await pool.query(
    `SELECT r.id, r.event_id, r.offset_minutes, r.remind_at,
            e.title, e.kind, e.starts_at
     FROM reminders r
     JOIN events e ON e.id = r.event_id
     WHERE r.remind_at <= now()
       AND r.sent_at IS NULL
       AND e.status = 'open'
     ORDER BY r.remind_at ASC`
  );

  for (const row of due.rows) {
    const offsetLabel =
      row.offset_minutes >= 1440
        ? `${row.offset_minutes / 1440} hari`
        : row.offset_minutes >= 60
          ? `${row.offset_minutes / 60} jam`
          : `${row.offset_minutes} menit`;

    const kindLabel = row.kind === 'task' ? '📌 Tugas' : '📅 Event';
    const startStr = formatWib(row.starts_at, 'dd LLL yyyy, HH:mm');
    const msg =
      `⏰ *Pengingat ${kindLabel}*\n` +
      `*${row.title}*\n` +
      `Waktu: ${startStr} WIB\n` +
      `_(${offsetLabel} lagi)_`;

    try {
      await sendText(targetJid, msg);
      await pool.query('UPDATE reminders SET sent_at = now() WHERE id = $1', [row.id]);
      logger.info({ reminderId: row.id, eventId: row.event_id }, 'Reminder terkirim');
    } catch (err) {
      logger.warn({ err: err.message, reminderId: row.id }, 'Gagal kirim reminder');
    }
  }
}

export default { addRemindersForEvent, runReminderJob };

