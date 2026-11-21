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
 * Mengambil satu catatan berdasarkan ID.
 * @param {number} id
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<object|null>}
 */
export async function getNoteById(id, client = pool) {
  const res = await client.query('SELECT * FROM notes WHERE id = $1', [id]);
  return res.rows[0] || null;
}

/**
 * List catatan dengan filter kata kunci, tanggal, tag, dan paginasi.
 * @param {object} [filter]
 * @param {string} [filter.q]
 * @param {string} [filter.date] YYYY-MM-DD
 * @param {string} [filter.tag]
 * @param {number} [filter.limit=50]
 * @param {number} [filter.offset=0]
 * @returns {Promise<object[]>}
 */
export async function listNotes(filter = {}) {
  const conditions = ['deleted_at IS NULL'];
  const values = [];

  if (filter.date) {
    values.push(filter.date);
    conditions.push(`note_date = $${values.length}`);
  }
  if (filter.tag) {
    values.push(filter.tag);
    conditions.push(`$${values.length} = ANY(tags)`);
  }
  if (filter.q) {
    values.push(filter.q);
    conditions.push(`(to_tsvector('simple', content) @@ plainto_tsquery('simple', $${values.length}) OR content ILIKE '%' || $${values.length} || '%')`);
  }

  const limit = Number(filter.limit) || 50;
  const offset = Number(filter.offset) || 0;
  values.push(limit);
  const limitIdx = values.length;
  values.push(offset);
  const offsetIdx = values.length;

  const res = await pool.query(
    `SELECT id, content, tags, note_date, created_at
     FROM notes
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    values
  );
  return res.rows;
}

/**
 * Memperbarui catatan.
 * @param {number} id
 * @param {{ content?: string, tags?: string[], noteDate?: string }} data
 * @param {object} [opts]
 * @returns {Promise<object>}
 */
export async function updateNote(id, data = {}, opts = {}) {
  const client = opts.client || pool;
  const updates = [];
  const values = [];

  if (data.content !== undefined) {
    const trimmed = data.content.trim();
    if (!trimmed) throw new Error('Konten catatan tidak boleh kosong.');
    values.push(trimmed);
    updates.push(`content = $${values.length}`);
  }
  if (data.tags !== undefined) {
    values.push(data.tags);
    updates.push(`tags = $${values.length}::text[]`);
  }
  if (data.noteDate !== undefined) {
    values.push(data.noteDate);
    updates.push(`note_date = $${values.length}`);
  }

  if (updates.length === 0) {
    return getNoteById(id, client);
  }

  values.push(id);
  const sql = `UPDATE notes SET ${updates.join(', ')} WHERE id = $${values.length} AND deleted_at IS NULL RETURNING *`;
  const res = await client.query(sql, values);
  if (res.rowCount === 0) {
    throw new Error(`Catatan #${id} tidak ditemukan.`);
  }
  return res.rows[0];
}

/**
 * Memulihkan catatan yang terhapus (soft delete).
 * @param {number} id
 * @param {object} [opts]
 * @returns {Promise<object>}
 */
export async function restoreNote(id, opts = {}) {
  const client = opts.client || pool;
  const res = await client.query(
    'UPDATE notes SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL RETURNING *',
    [id]
  );
  if (res.rowCount === 0) {
    throw new Error(`Catatan #${id} tidak ditemukan atau tidak sedang dihapus.`);
  }
  return res.rows[0];
}

export default { addNote, searchNotes, deleteNote, listNotes, getNoteById, updateNote, restoreNote };

