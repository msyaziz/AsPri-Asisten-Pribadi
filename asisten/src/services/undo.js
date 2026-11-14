/**
 * Service Undo & Koreksi / Ralat.
 * Sesuai prd.md §8.8, §10 dan 02-fase2-keuangan-inti.md.
 */

import { pool } from '../db/pool.js';
import { deleteTransaction, updateTransaction, getTransactionById } from './transactions.js';
import { deleteTransfer } from './transfers.js';

function safeJson(obj) {
  if (obj === null || obj === undefined) return null;
  return JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

/**
 * Mencari aksi terakhir yang masih bisa dibatalkan (undoable) dalam jendela waktu tertentu (default 24 jam).
 * Mendukung reply ke pesan bot tertentu (via botReplyId).
 * @param {object} [opts]
 * @param {number} [opts.windowHours=24]
 * @param {string} [opts.botReplyId]
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<object|null>}
 */
export async function getLastUndoableAction(opts = {}, client = pool) {
  const { windowHours = 24, botReplyId = null } = opts;

  if (botReplyId) {
    const res = await client.query(
      `SELECT * FROM action_log
       WHERE bot_reply_id = $1 AND undone = FALSE
       ORDER BY id DESC
       LIMIT 1`,
      [botReplyId]
    );
    if (res.rows.length > 0) return res.rows[0];
  }

  const res = await client.query(
    `SELECT * FROM action_log
     WHERE undone = FALSE
       AND action IN ('create', 'update', 'delete')
       AND created_at > now() - ($1 || ' hours')::interval
     ORDER BY id DESC
     LIMIT 1`,
    [windowHours]
  );
  return res.rows[0] || null;
}

/**
 * Membatalkan aksi berdasarkan ID baris di action_log.
 * Mengembalikan saldo ke kondisi sebelumnya secara presisi.
 * @param {number|bigint} actionLogId
 * @param {object} [opts]
 * @param {import('pg').PoolClient} [opts.client]
 * @returns {Promise<object>}
 */
export async function undoAction(actionLogId, opts = {}) {
  const client = opts.client || pool;

  const logRes = await client.query('SELECT * FROM action_log WHERE id = $1', [actionLogId]);
  const logRow = logRes.rows[0];
  if (!logRow) {
    throw new Error(`Catatan aksi #${actionLogId} tidak ditemukan.`);
  }
  if (logRow.undone) {
    throw new Error(`Aksi #${actionLogId} sudah pernah dibatalkan sebelumnya.`);
  }

  const { entity, entity_id: entityId, action } = logRow;
  let detail = null;

  if (entity === 'transaction') {
    if (action === 'create') {
      // Membatalkan pembuatan transaksi -> soft delete
      detail = await deleteTransaction(entityId, { botReplyId: null }, client);
    } else if (action === 'delete') {
      // Membatalkan penghapusan transaksi -> restore
      const restoreRes = await client.query(
        'UPDATE transactions SET deleted_at = NULL WHERE id = $1 RETURNING *',
        [entityId]
      );
      detail = restoreRes.rows[0];
      await client.query(
        `INSERT INTO action_log (entity, entity_id, action, before_data, after_data)
         VALUES ('transaction', $1, 'restore', $2, $3)`,
        [entityId, safeJson(logRow.before_data), safeJson(detail)]
      );
    } else if (action === 'update') {
      // Membatalkan ralat/update transaksi -> pulihkan data lama dari before_data
      const beforeData =
        typeof logRow.before_data === 'string'
          ? JSON.parse(logRow.before_data)
          : logRow.before_data;

      detail = await updateTransaction(
        entityId,
        {
          amount: beforeData.amount,
          categoryId: beforeData.category_id,
          pocketId: beforeData.pocket_id,
          note: beforeData.note,
        },
        {},
        client
      );
    }
  } else if (entity === 'transfer') {
    if (action === 'create') {
      // Membatalkan transfer -> soft delete
      detail = await deleteTransfer(entityId, {}, client);
    } else if (action === 'delete') {
      // Membatalkan penghapusan transfer -> restore
      const restoreRes = await client.query(
        'UPDATE pocket_transfers SET deleted_at = NULL WHERE id = $1 RETURNING *',
        [entityId]
      );
      detail = restoreRes.rows[0];
    }
  } else {
    throw new Error(`Entitas '${entity}' belum mendukung undo.`);
  }

  // Tandai action_log ini sebagai undone = TRUE
  await client.query('UPDATE action_log SET undone = TRUE WHERE id = $1', [actionLogId]);

  return {
    success: true,
    actionLogId,
    entity,
    entityId,
    undoneAction: action,
    detail,
  };
}

/**
 * Mengambil transaksi aktif terakhir dalam 24 jam terakhir.
 * Digunakan untuk perintah fast-path: `ralat jadi 30rb` atau `ubah kategori jadi X`.
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<object|null>}
 */
export async function getLastTransaction(client = pool) {
  const res = await client.query(
    `SELECT t.*, p.name AS pocket_name, c.name AS category_name
     FROM transactions t
     LEFT JOIN pockets p ON p.id = t.pocket_id
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.deleted_at IS NULL
       AND t.created_at > now() - interval '24 hours'
     ORDER BY t.id DESC
     LIMIT 1`
  );
  if (res.rows.length === 0) return null;
  return {
    ...res.rows[0],
    amount: BigInt(res.rows[0].amount),
  };
}

/**
 * Melakukan ralat / koreksi pada transaksi terakhir.
 * Menyimpan snapshot nilai lama di action_log.before_data.
 * @param {object} patch
 * @param {number|bigint} [patch.amount]
 * @param {number} [patch.categoryId]
 * @param {number} [patch.pocketId]
 * @param {string} [patch.note]
 * @param {object} [opts]
 * @param {string} [opts.botReplyId]
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<{ previous: object, updated: object }>}
 */
export async function reviseLastTransaction(patch, opts = {}, client = pool) {
  const lastTx = await getLastTransaction(client);
  if (!lastTx) {
    throw new Error('Tidak ada transaksi dalam 24 jam terakhir yang dapat diralat.');
  }

  const updated = await updateTransaction(lastTx.id, patch, opts, client);
  return {
    previous: lastTx,
    updated,
  };
}

