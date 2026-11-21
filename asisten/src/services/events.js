/**
 * Service layer untuk Agenda – Events & Tasks.
 * Fase 4 – prd.md §8.11
 */

import { pool } from '../db/pool.js';
import { z } from 'zod';
import { parseRecurrence } from '../utils/recurrence.js';
import { DateTime } from 'luxon';
import { CONSTANTS } from '../config/constants.js';

const TZ = CONSTANTS.TIMEZONE;

const eventSchema = z.object({
  kind: z.enum(['event', 'task']),
  title: z.string().min(1),
  startsAt: z.string().min(1),
  endsAt: z.string().optional(),
  recurrence: z.string().optional(),
  remindOffsets: z.array(z.number()).optional(),
});

/**
 * Ambil default remind offsets dari settings DB.
 * @returns {Promise<number[]>} minutes before start
 */
async function getDefaultOffsets() {
  const res = await pool.query("SELECT value FROM settings WHERE key = 'remind_offsets'");
  if (res.rows.length > 0) {
    try { return JSON.parse(res.rows[0].value); } catch { /* use default */ }
  }
  return [1440, 60]; // 24h dan 1h sebelum event
}

/**
 * Buat entri reminders berdasarkan event_id, starts_at, dan offset (menit).
 * @param {number} eventId
 * @param {Date|string} startsAt
 * @param {number[]} offsets
 */
async function createReminders(eventId, startsAt, offsets) {
  const start = new Date(typeof startsAt === 'string' ? startsAt : startsAt.toISOString());
  const now = new Date();
  for (const offsetMin of offsets) {
    const remindAt = new Date(start.getTime() - offsetMin * 60 * 1000);
    if (remindAt <= now) continue;
    await pool.query(
      `INSERT INTO reminders (event_id, remind_at, offset_minutes)
       VALUES ($1, $2, $3)
       ON CONFLICT (event_id, offset_minutes) DO NOTHING`,
      [eventId, remindAt.toISOString(), offsetMin]
    );
  }
}

/**
 * Tambah event atau task baru.
 * @param {object} data
 * @param {object} [opts]
 * @param {string} [opts.botReplyId]
 * @param {import('pg').PoolClient} [opts.client]
 * @returns {Promise<number>} id event baru
 */
export async function addEvent(data, opts = {}) {
  const client = opts.client || pool;
  const parsed = eventSchema.parse(data);

  const res = await client.query(
    `INSERT INTO events (kind, title, starts_at, ends_at, recurrence)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, starts_at, kind, title, recurrence`,
    [
      parsed.kind,
      parsed.title,
      parsed.startsAt,
      parsed.endsAt || null,
      parsed.recurrence || null,
    ]
  );

  const id = Number(res.rows[0].id);
  const starts_at = res.rows[0].starts_at;
  const offsets = parsed.remindOffsets || (await getDefaultOffsets());
  await createReminders(id, starts_at, offsets);

  // Catat di action_log untuk undo
  await client.query(
    `INSERT INTO action_log (entity, entity_id, action, after_data, bot_reply_id)
     VALUES ('event', $1, 'create', $2, $3)`,
    [id, JSON.stringify(res.rows[0]), opts.botReplyId || null]
  );

  return id;
}

/**
 * Tandai task sebagai selesai (status = 'done').
 * @param {number} eventId
 * @param {object} [opts]
 * @param {string} [opts.botReplyId]
 * @param {import('pg').PoolClient} [opts.client]
 * @returns {Promise<boolean>}
 */
export async function completeTask(eventId, opts = {}) {
  const client = opts.client || pool;
  const ev = await client.query('SELECT * FROM events WHERE id = $1', [eventId]);
  if (ev.rowCount === 0) throw new Error('Event tidak ditemukan.');
  if (ev.rows[0].kind !== 'task') throw new Error('Hanya task yang bisa diselesaikan.');

  await client.query(
    "UPDATE events SET status = 'done' WHERE id = $1",
    [eventId]
  );
  await client.query('DELETE FROM reminders WHERE event_id = $1', [eventId]);

  // Catat di action_log untuk undo
  await client.query(
    `INSERT INTO action_log (entity, entity_id, action, before_data, after_data, bot_reply_id)
     VALUES ('event', $1, 'update', $2, $3, $4)`,
    [
      eventId,
      JSON.stringify({ status: ev.rows[0].status }),
      JSON.stringify({ status: 'done' }),
      opts.botReplyId || null,
    ]
  );

  return true;
}

/**
 * Mengambil satu event berdasarkan ID.
 * @param {number} id
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<object|null>}
 */
export async function getEventById(id, client = pool) {
  const res = await client.query('SELECT * FROM events WHERE id = $1', [id]);
  return res.rows[0] || null;
}

/**
 * Daftar events/tasks dengan filter opsional.
 * @param {object} [filter]
 * @param {string} [filter.kind] 'event'|'task'
 * @param {string} [filter.status] 'open'|'done'|'cancelled'
 * @param {string} [filter.date] YYYY-MM-DD
 * @param {string} [filter.from] ISO date string
 * @param {string} [filter.to] ISO date string
 * @param {boolean} [filter.includeDeleted]
 * @returns {Promise<object[]>}
 */
export async function listEvents(filter = {}) {
  const conditions = [];
  const values = [];
  let idx = 1;

  if (!filter.includeDeleted) {
    conditions.push('deleted_at IS NULL');
  }
  if (filter.kind) {
    conditions.push(`kind = $${idx++}`);
    values.push(filter.kind);
  }
  if (filter.status) {
    conditions.push(`status = $${idx++}`);
    values.push(filter.status);
  }
  if (filter.date) {
    conditions.push(`DATE(starts_at AT TIME ZONE 'Asia/Jakarta') = $${idx++}`);
    values.push(filter.date);
  }
  if (filter.from) {
    conditions.push(`starts_at >= $${idx++}`);
    values.push(filter.from);
  }
  if (filter.to) {
    conditions.push(`starts_at <= $${idx++}`);
    values.push(filter.to);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const res = await pool.query(
    `SELECT * FROM events ${where} ORDER BY starts_at ASC`,
    values
  );
  return res.rows;
}

/**
 * Memperbarui data event/task.
 * @param {number} id
 * @param {object} patch
 * @param {object} [opts]
 * @returns {Promise<object>}
 */
export async function updateEvent(id, patch, opts = {}) {
  const client = opts.client || pool;
  const updates = [];
  const values = [];

  if (patch.title !== undefined) {
    values.push(patch.title);
    updates.push(`title = $${values.length}`);
  }
  if (patch.description !== undefined) {
    values.push(patch.description);
    updates.push(`description = $${values.length}`);
  }
  if (patch.startsAt !== undefined) {
    values.push(patch.startsAt);
    updates.push(`starts_at = $${values.length}`);
  }
  if (patch.endsAt !== undefined) {
    values.push(patch.endsAt);
    updates.push(`ends_at = $${values.length}`);
  }
  if (patch.status !== undefined) {
    values.push(patch.status);
    updates.push(`status = $${values.length}`);
  }
  if (patch.kind !== undefined) {
    values.push(patch.kind);
    updates.push(`kind = $${values.length}`);
  }
  if (patch.recurrence !== undefined) {
    values.push(patch.recurrence);
    updates.push(`recurrence = $${values.length}`);
  }
  if (patch.allDay !== undefined) {
    values.push(Boolean(patch.allDay));
    updates.push(`all_day = $${values.length}`);
  }

  if (updates.length === 0) {
    return getEventById(id, client);
  }

  values.push(id);
  const sql = `UPDATE events SET ${updates.join(', ')} WHERE id = $${values.length} AND deleted_at IS NULL RETURNING *`;
  const res = await client.query(sql, values);
  if (res.rows.length === 0) {
    throw new Error(`Event #${id} tidak ditemukan.`);
  }

  const ev = res.rows[0];
  if (patch.startsAt !== undefined) {
    await client.query('DELETE FROM reminders WHERE event_id = $1', [id]);
    const offsets = ev.remind_offsets || (await getDefaultOffsets());
    await createReminders(ev.id, ev.starts_at, offsets);
  }

  return ev;
}

/**
 * Soft delete event/task.
 * @param {number} id
 * @param {object} [opts]
 * @returns {Promise<object>}
 */
export async function deleteEvent(id, opts = {}) {
  const client = opts.client || pool;
  const res = await client.query(
    'UPDATE events SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING *',
    [id]
  );
  if (res.rows.length === 0) {
    throw new Error(`Event #${id} tidak ditemukan.`);
  }
  await client.query('DELETE FROM reminders WHERE event_id = $1', [id]);
  return res.rows[0];
}

/**
 * Pulihkan event/task yang telah dihapus.
 * @param {number} id
 * @param {object} [opts]
 * @returns {Promise<object>}
 */
export async function restoreEvent(id, opts = {}) {
  const client = opts.client || pool;
  const res = await client.query(
    'UPDATE events SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL RETURNING *',
    [id]
  );
  if (res.rows.length === 0) {
    throw new Error(`Event #${id} tidak ditemukan atau tidak sedang dihapus.`);
  }
  const ev = res.rows[0];
  const offsets = ev.remind_offsets || (await getDefaultOffsets());
  await createReminders(ev.id, ev.starts_at, offsets);
  return ev;
}

/**
 * Ekspansi recurrence untuk events yang punya rule berulang.
 * @param {number} horizonDays - berapa hari ke depan (default 30)
 */
export async function expandRecurrences(horizonDays = 30) {
  const res = await pool.query(
    "SELECT * FROM events WHERE recurrence IS NOT NULL AND status = 'open'"
  );

  const horizon = DateTime.now().setZone(TZ).plus({ days: horizonDays });

  for (const ev of res.rows) {
    const next = parseRecurrence(ev.recurrence, ev.starts_at);
    if (!next) continue;

    const nextDt = DateTime.fromISO(next.start).setZone(TZ);
    if (nextDt > horizon) continue;

    // Cek duplikat berdasarkan title + starts_at + recurrence
    const existing = await pool.query(
      `SELECT id FROM events WHERE title = $1 AND starts_at = $2 AND recurrence = $3`,
      [ev.title, next.start, ev.recurrence]
    );
    if (existing.rowCount > 0) continue;

    const inserted = await pool.query(
      `INSERT INTO events (kind, title, starts_at, ends_at, recurrence)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, starts_at`,
      [ev.kind, ev.title, next.start, next.end || null, ev.recurrence]
    );

    const newId = Number(inserted.rows[0].id);
    const starts_at = inserted.rows[0].starts_at;
    const offsets = await getDefaultOffsets();
    await createReminders(newId, starts_at, offsets);
  }
}

export { createReminders };
export default { addEvent, completeTask, listEvents, expandRecurrences };
