/**
 * Service Transfer Antar Kantong & Saldo Utama.
 * Sesuai prd.md §8.5, §9.3-9.5 dan 02-fase2-keuangan-inti.md.
 */

import { pool } from '../db/pool.js';
import { getMainBalance } from './periods.js';
import { getPocketBalance, getPocketById } from './pockets.js';
import { formatRupiah } from '../utils/rupiah.js';

function safeJson(obj) {
  if (obj === null || obj === undefined) return null;
  return JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

/**
 * Melakukan transfer dana antar kantong atau antara saldo utama dan kantong.
 * NULL pada fromPocketId atau toPocketId merepresentasikan Saldo Utama.
 * @param {object} params
 * @param {number} params.periodId
 * @param {number|null} params.fromPocketId
 * @param {number|null} params.toPocketId
 * @param {number|bigint} params.amount
 * @param {string} [params.note]
 * @param {string} [params.botReplyId]
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<object>}
 */
export async function transferBetweenPockets(params, client = pool) {
  const {
    periodId,
    fromPocketId = null,
    toPocketId = null,
    amount,
    note = null,
    botReplyId = null,
  } = params;

  const numAmount = typeof amount === 'bigint' ? amount : BigInt(Math.round(Number(amount)));
  if (numAmount <= 0n) {
    throw new Error('Nominal transfer harus lebih besar dari 0.');
  }

  // fromPocketId dan toPocketId tidak boleh sama
  if (fromPocketId === toPocketId) {
    throw new Error('Sumber dan tujuan transfer tidak boleh sama.');
  }

  // 1. Validasi saldo sumber (tidak boleh transfer melebihi saldo yang tersedia)
  let fromName = 'Saldo Utama';
  if (fromPocketId === null) {
    const mainBal = await getMainBalance(periodId, client);
    if (mainBal < numAmount) {
      throw new Error(
        `Saldo Utama tidak mencukupi untuk transfer ${formatRupiah(numAmount)} (tersedia: ${formatRupiah(mainBal)}).`
      );
    }
  } else {
    const pocket = await getPocketById(fromPocketId, client);
    if (!pocket) {
      throw new Error(`Kantong asal dengan ID ${fromPocketId} tidak ditemukan.`);
    }
    fromName = pocket.name;
    const pBal = await getPocketBalance(periodId, fromPocketId, client);
    const available = pBal ? pBal.balance : 0n;
    if (available < numAmount) {
      throw new Error(
        `Saldo kantong ${fromName} tidak mencukupi untuk transfer ${formatRupiah(numAmount)} (tersedia: ${formatRupiah(available)}).`
      );
    }
  }

  let toName = 'Saldo Utama';
  if (toPocketId !== null) {
    const pocket = await getPocketById(toPocketId, client);
    if (!pocket) {
      throw new Error(`Kantong tujuan dengan ID ${toPocketId} tidak ditemukan.`);
    }
    toName = pocket.name;
  }

  // 2. Eksekusi insert transfer
  const insertRes = await client.query(
    `INSERT INTO pocket_transfers (
       period_id, from_pocket_id, to_pocket_id, amount, note, bot_reply_id
     ) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      periodId,
      fromPocketId,
      toPocketId,
      numAmount.toString(),
      note,
      botReplyId,
    ]
  );
  const transfer = insertRes.rows[0];

  // 3. Catat di action_log untuk audit & undo
  await client.query(
    `INSERT INTO action_log (entity, entity_id, action, after_data, bot_reply_id)
     VALUES ('transfer', $1, 'create', $2, $3)`,
    [transfer.id, safeJson(transfer), botReplyId]
  );

  // 4. Ambil saldo terbaru setelah transfer
  const fromBalanceAfter =
    fromPocketId === null
      ? await getMainBalance(periodId, client)
      : (await getPocketBalance(periodId, fromPocketId, client))?.balance || 0n;

  const toBalanceAfter =
    toPocketId === null
      ? await getMainBalance(periodId, client)
      : (await getPocketBalance(periodId, toPocketId, client))?.balance || 0n;

  return {
    transfer: {
      ...transfer,
      amount: numAmount,
    },
    fromName,
    toName,
    fromBalanceAfter,
    toBalanceAfter,
  };
}

/**
 * Mengambil daftar riwayat transfer.
 * @param {object} filter
 * @param {number} filter.periodId
 * @param {number} [filter.limit=50]
 * @param {number} [filter.offset=0]
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<Array<object>>}
 */
export async function getTransfers(filter, client = pool) {
  const { periodId, limit = 50, offset = 0 } = filter;
  const sql = `
    SELECT
      t.*,
      pf.name AS from_pocket_name,
      pt.name AS to_pocket_name
    FROM pocket_transfers t
    LEFT JOIN pockets pf ON pf.id = t.from_pocket_id
    LEFT JOIN pockets pt ON pt.id = t.to_pocket_id
    WHERE t.period_id = $1 AND t.deleted_at IS NULL
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT $2 OFFSET $3
  `;
  const res = await client.query(sql, [periodId, limit, offset]);
  return res.rows.map((r) => ({
    ...r,
    amount: BigInt(r.amount),
  }));
}

/**
 * Menghapus / membatalkan transfer (soft delete).
 * @param {number|bigint} id
 * @param {object} [opts]
 * @param {string} [opts.botReplyId]
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<object>}
 */
export async function deleteTransfer(id, opts = {}, client = pool) {
  const findRes = await client.query(
    'SELECT * FROM pocket_transfers WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );
  const existing = findRes.rows[0];
  if (!existing) {
    throw new Error(`Transfer #${id} tidak ditemukan atau sudah dibatalkan.`);
  }

  const res = await client.query(
    'UPDATE pocket_transfers SET deleted_at = now() WHERE id = $1 RETURNING *',
    [id]
  );
  const deleted = res.rows[0];

  await client.query(
    `INSERT INTO action_log (entity, entity_id, action, before_data, after_data, bot_reply_id)
     VALUES ('transfer', $1, 'delete', $2, $3, $4)`,
    [id, safeJson(existing), safeJson(deleted), opts.botReplyId || null]
  );

  return deleted;
}
