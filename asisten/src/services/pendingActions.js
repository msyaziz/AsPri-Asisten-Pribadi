/**
 * Service Pending Actions (Konfirmasi ya/tidak).
 * Sesuai prd.md §8.7, §9.3 dan 02-fase2-keuangan-inti.md.
 */

import { pool } from '../db/pool.js';

/**
 * Membuat aksi pending baru yang menunggu konfirmasi pengguna.
 * @param {object} params
 * @param {string} params.type 'transaksi_besar' | 'uang_bulanan' | 'hapus_kantong' | 'struk' | 'pilih_kategori'
 * @param {object} params.payload Data yang akan dieksekusi jika dikonfirmasi 'ya'
 * @param {string} [params.waMessageId]
 * @param {string} [params.botReplyId]
 * @param {number} [params.timeoutMinutes=10] Waktu kedaluwarsa dalam menit (default 10)
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<object>}
 */
export async function createPendingAction(params, client = pool) {
  const {
    type,
    payload,
    waMessageId = null,
    botReplyId = null,
    timeoutMinutes = 10,
  } = params;

  const res = await client.query(
    `INSERT INTO pending_actions (
       type, payload, wa_message_id, bot_reply_id, status, expires_at
     ) VALUES ($1, $2, $3, $4, 'waiting', now() + ($5 || ' minutes')::interval)
     RETURNING *`,
    [type, JSON.stringify(payload), waMessageId, botReplyId, timeoutMinutes]
  );
  return res.rows[0];
}

/**
 * Mengambil aksi pending yang masih aktif (belum kedaluwarsa dan status waiting).
 * Secara otomatis memperbarui status aksi yang sudah kedaluwarsa menjadi 'expired'.
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<object|null>}
 */
export async function getActivePendingAction(client = pool) {
  // Tandai yang sudah lewat waktu sebagai 'expired'
  await client.query(
    `UPDATE pending_actions
     SET status = 'expired'
     WHERE status = 'waiting' AND expires_at <= now()`
  );

  const res = await client.query(
    `SELECT * FROM pending_actions
     WHERE status = 'waiting' AND expires_at > now()
     ORDER BY id DESC
     LIMIT 1`
  );
  return res.rows[0] || null;
}

/**
 * Menyelesaikan pending action (dikonfirmasi 'confirmed' atau ditolak 'rejected').
 * @param {number|bigint} id
 * @param {'confirmed'|'rejected'|'expired'} resolution
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<object>}
 */
export async function resolvePendingAction(id, resolution, client = pool) {
  const res = await client.query(
    `UPDATE pending_actions
     SET status = $1
     WHERE id = $2
     RETURNING *`,
    [resolution, id]
  );
  if (res.rows.length === 0) {
    throw new Error(`Pending action #${id} tidak ditemukan.`);
  }
  return res.rows[0];
}
