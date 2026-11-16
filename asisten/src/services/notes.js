/**
 * Service layer untuk Catatan (notes).
 * Fase 4 – prd.md §8.11
 */

import { pool } from '../db/pool.js';
import { z } from 'zod';

const noteSchema = z.object({
  content: z.string().min(1),
  tags: z.array(z.string()).optional(),
  noteDate: z.string().optional(), // YYYY-MM-DD, default today
});

/**
 * Tambah catatan baru.
 * @param {object} data
 * @param {object} [opts]
 * @param {string} [opts.botReplyId]
 * @param {import('pg').PoolClient} [opts.client]
 * @returns {Promise<number>} id catatan baru
 */
export async function addNote(data, opts = {}) {
  const client = opts.client || pool;
  const parsed = noteSchema.parse(data);
  const tags = parsed.tags || [];
  const noteDate = parsed.noteDate || new Date().toISOString().split('T')[0];

  const res = await client.query(
    `INSERT INTO notes (content, tags, note_date)
     VALUES ($1, $2::text[], $3)
     RETURNING id, content, tags, note_date`,
    [parsed.content, tags, noteDate]
  );
  const id = Number(res.rows[0].id);

  // Catat di action_log untuk undo
  await client.query(
    `INSERT INTO action_log (entity, entity_id, action, after_data, bot_reply_id)
     VALUES ('note', $1, 'create', $2, $3)`,
    [id, JSON.stringify(res.rows[0]), opts.botReplyId || null]
  );

  return id;
}

/**
 * Cari catatan berdasarkan kata kunci (full-text search).
 * @param {string} keyword
 * @returns {Promise<object[]>}
 */
export async function searchNotes(keyword) {
  const res = await pool.query(
    `SELECT id, content, tags, note_date, created_at
     FROM notes
     WHERE deleted_at IS NULL
       AND to_tsvector('simple', content) @@ plainto_tsquery('simple', $1)
     ORDER BY created_at DESC
     LIMIT 20`,
    [keyword]
  );
  return res.rows;
}

/**
 * Soft-delete catatan berdasarkan ID.
 * @param {number} noteId
 * @param {object} [opts]
 * @param {string} [opts.botReplyId]
 * @param {import('pg').PoolClient} [opts.client]
 * @returns {Promise<boolean>}
 */
export async function deleteNote(noteId, opts = {}) {
  const client = opts.client || pool;
  const prev = await client.query('SELECT * FROM notes WHERE id = $1 AND deleted_at IS NULL', [noteId]);
  if (prev.rowCount === 0) throw new Error(`Catatan #${noteId} tidak ditemukan.`);

  const res = await client.query(
    `UPDATE notes SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [noteId]
  );

  // Catat di action_log untuk undo
  await client.query(
    `INSERT INTO action_log (entity, entity_id, action, before_data, bot_reply_id)
     VALUES ('note', $1, 'delete', $2, $3)`,
    [noteId, JSON.stringify(prev.rows[0]), opts.botReplyId || null]
  );

  return true;
}

/**
 * List catatan terbaru (opsional filter tanggal).
 * @param {object} [filter]
 * @param {string} [filter.date] YYYY-MM-DD
 * @returns {Promise<object[]>}
 */
export async function listNotes(filter = {}) {
  const values = [];
  let where = 'WHERE deleted_at IS NULL';
  if (filter.date) {
    values.push(filter.date);
    where += ` AND note_date = $${values.length}`;
  }
  const res = await pool.query(
    `SELECT id, content, tags, note_date, created_at
     FROM notes ${where}
     ORDER BY created_at DESC LIMIT 30`,
    values
  );
  return res.rows;
}

export default { addNote, searchNotes, deleteNote, listNotes };

