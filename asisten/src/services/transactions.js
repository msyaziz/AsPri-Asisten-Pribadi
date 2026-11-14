/**
 * Service Transaksi & Uang Bulanan.
 * Sesuai prd.md §8.1-8.3, §9.3-9.5 dan 02-fase2-keuangan-inti.md.
 */

import { pool } from '../db/pool.js';
import { getPeriodByDate, getMainBalance, getTotalMoney } from './periods.js';
import { getPocketBalances } from './pockets.js';
import { getWibDateString } from '../utils/time.js';

function safeJson(obj) {
  if (obj === null || obj === undefined) return null;
  return JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

/**
 * Mencatat transaksi baru (pengeluaran atau pemasukan).
 * @param {object} params
 * @param {number} [params.periodId]
 * @param {'masuk'|'keluar'} params.type
 * @param {number|bigint} params.amount
 * @param {number} [params.categoryId]
 * @param {number} [params.pocketId]
 * @param {string} [params.note]
 * @param {string} [params.txDate] Format YYYY-MM-DD
 * @param {'teks'|'struk'|'dashboard'|'recurring'} [params.source='teks']
 * @param {boolean} [params.isMonthlyIncome=false]
 * @param {number} [params.aiConfidence]
 * @param {string} [params.waMessageId]
 * @param {string} [params.botReplyId]
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<object>} Baris transaksi yang berhasil dibuat
 */
export async function addTransaction(params, client = pool) {
  const {
    type,
    amount,
    categoryId = null,
    pocketId: initialPocketId = null,
    note = null,
    txDate: initialTxDate,
    source = 'teks',
    isMonthlyIncome = false,
    aiConfidence = null,
    waMessageId = null,
    botReplyId = null,
  } = params;

  const numAmount = typeof amount === 'bigint' ? amount : BigInt(Math.round(Number(amount)));
  if (numAmount <= 0n) {
    throw new Error('Nominal transaksi harus lebih besar dari 0.');
  }

  if (type !== 'masuk' && type !== 'keluar') {
    throw new Error(`Tipe transaksi tidak valid: ${type}. Harus 'masuk' atau 'keluar'.`);
  }

  const txDate = initialTxDate || getWibDateString();
  let periodId = params.periodId;
  if (!periodId) {
    const period = await getPeriodByDate(txDate, client);
    periodId = period.id;
  }

  // Jika pocketId tidak diisi dan categoryId ada, ambil default_pocket_id kategori
  let pocketId = initialPocketId;
  if (!pocketId && categoryId) {
    const catRes = await client.query(
      'SELECT default_pocket_id FROM categories WHERE id = $1',
      [categoryId]
    );
    if (catRes.rows[0]?.default_pocket_id) {
      pocketId = catRes.rows[0].default_pocket_id;
    }
  }

  // Insert transaksi
  const insertRes = await client.query(
    `INSERT INTO transactions (
       period_id, type, amount, category_id, pocket_id, note,
       tx_date, source, is_monthly_income, ai_confidence,
       wa_message_id, bot_reply_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      periodId,
      type,
      numAmount.toString(),
      categoryId,
      pocketId,
      note,
      txDate,
      source,
      isMonthlyIncome,
      aiConfidence,
      waMessageId,
      botReplyId,
    ]
  );
  const transaction = {
    ...insertRes.rows[0],
    amount: BigInt(insertRes.rows[0].amount),
  };

  // Catat di action_log untuk audit & undo
  await client.query(
    `INSERT INTO action_log (entity, entity_id, action, after_data, bot_reply_id)
     VALUES ('transaction', $1, 'create', $2, $3)`,
    [transaction.id, safeJson(transaction), botReplyId]
  );

  return transaction;
}

/**
 * Mencatat uang bulanan (gaji) dan secara otomatis menghitung alokasi untuk tiap kantong aktif.
 * @param {object} params
 * @param {number} [params.periodId]
 * @param {number|bigint} params.amount
 * @param {'tambah'|'ganti'} [params.mode='tambah']
 * @param {string} [params.txDate]
 * @param {string} [params.waMessageId]
 * @param {string} [params.botReplyId]
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<object>}
 */
export async function setMonthlyIncome(params, client = pool) {
  const {
    amount,
    mode = 'tambah',
    txDate: initialTxDate,
    waMessageId = null,
    botReplyId = null,
  } = params;

  const numAmount = typeof amount === 'bigint' ? amount : BigInt(Math.round(Number(amount)));
  if (numAmount <= 0n) {
    throw new Error('Nominal uang bulanan harus lebih besar dari 0.');
  }

  const txDate = initialTxDate || getWibDateString();
  let periodId = params.periodId;
  if (!periodId) {
    const period = await getPeriodByDate(txDate, client);
    periodId = period.id;
  }

  // Jika mode 'ganti', hapus (soft delete) transaksi uang bulanan yang lama di periode ini
  if (mode === 'ganti') {
    await client.query(
      `UPDATE transactions
       SET deleted_at = now()
       WHERE period_id = $1 AND is_monthly_income = TRUE AND deleted_at IS NULL`,
      [periodId]
    );
  }

  // Catat transaksi uang bulanan (masuk ke saldo utama, pocket_id = NULL)
  const transaction = await addTransaction(
    {
      periodId,
      type: 'masuk',
      amount: numAmount,
      categoryId: null, // Gaji masuk ke pool utama
      pocketId: null,
      note: 'Uang bulanan',
      txDate,
      isMonthlyIncome: true,
      waMessageId,
      botReplyId,
    },
    client
  );

  // Hitung ulang total uang bulanan di periode ini
  const incomeRes = await client.query(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM transactions
     WHERE period_id = $1 AND is_monthly_income = TRUE AND deleted_at IS NULL`,
    [periodId]
  );
  const totalMonthlyIncome = BigInt(incomeRes.rows[0].total || 0);

  // Perbarui alloc_amount untuk setiap kantong di period_pockets berdasarkan alloc_percent
  const ppRes = await client.query(
    `SELECT pp.pocket_id, p.name AS pocket_name, pp.alloc_percent
     FROM period_pockets pp
     JOIN pockets p ON p.id = pp.pocket_id
     WHERE pp.period_id = $1`,
    [periodId]
  );

  const allocations = [];
  for (const row of ppRes.rows) {
    const percent = parseFloat(row.alloc_percent) || 0;
    let allocAmount = 0n;
    if (percent > 0 && totalMonthlyIncome > 0n) {
      // FLOOR(persen/100 * totalMonthlyIncome)
      allocAmount = (BigInt(Math.floor(percent * 100)) * totalMonthlyIncome) / 10000n;
    }

    await client.query(
      'UPDATE period_pockets SET alloc_amount = $1 WHERE period_id = $2 AND pocket_id = $3',
      [allocAmount.toString(), periodId, row.pocket_id]
    );

    allocations.push({
      pocketId: row.pocket_id,
      pocketName: row.pocket_name,
      percent,
      allocAmount,
    });
  }

  const mainBalance = await getMainBalance(periodId, client);
  const totalMoney = await getTotalMoney(periodId, client);
  const pocketBalances = await getPocketBalances(periodId, client);

  return {
    transaction,
    allocations,
    mainBalance,
    totalMoney,
    pocketBalances,
  };
}

/**
 * Mengambil transaksi berdasarkan filter.
 * @param {object} filter
 * @param {number} [filter.periodId]
 * @param {number} [filter.pocketId]
 * @param {number} [filter.categoryId]
 * @param {'masuk'|'keluar'} [filter.type]
 * @param {string} [filter.dateFrom]
 * @param {string} [filter.dateTo]
 * @param {number} [filter.limit=50]
 * @param {number} [filter.offset=0]
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<Array<object>>}
 */
export async function getTransactions(filter = {}, client = pool) {
  const {
    periodId,
    pocketId,
    categoryId,
    type,
    dateFrom,
    dateTo,
    limit = 50,
    offset = 0,
  } = filter;

  const conditions = ['t.deleted_at IS NULL'];
  const values = [];

  if (periodId) {
    values.push(periodId);
    conditions.push(`t.period_id = $${values.length}`);
  }
  if (pocketId !== undefined) {
    if (pocketId === null) {
      conditions.push('t.pocket_id IS NULL');
    } else {
      values.push(pocketId);
      conditions.push(`t.pocket_id = $${values.length}`);
    }
  }
  if (categoryId) {
    values.push(categoryId);
    conditions.push(`t.category_id = $${values.length}`);
  }
  if (type) {
    values.push(type);
    conditions.push(`t.type = $${values.length}`);
  }
  if (dateFrom) {
    values.push(dateFrom);
    conditions.push(`t.tx_date >= $${values.length}`);
  }
  if (dateTo) {
    values.push(dateTo);
    conditions.push(`t.tx_date <= $${values.length}`);
  }

  values.push(limit);
  const limitIdx = values.length;
  values.push(offset);
  const offsetIdx = values.length;

  const sql = `
    SELECT
      t.*,
      p.name AS pocket_name,
      c.name AS category_name
    FROM transactions t
    LEFT JOIN pockets p ON p.id = t.pocket_id
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY t.tx_date DESC, t.id DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  const res = await client.query(sql, values);
  return res.rows.map((r) => ({
    ...r,
    amount: BigInt(r.amount),
  }));
}

/**
 * Mengambil transaksi berdasarkan ID.
 * @param {number|bigint} id
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<object|null>}
 */
export async function getTransactionById(id, client = pool) {
  const res = await client.query(
    `SELECT t.*, p.name AS pocket_name, c.name AS category_name
     FROM transactions t
     LEFT JOIN pockets p ON p.id = t.pocket_id
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.id = $1`,
    [id]
  );
  if (res.rows.length === 0) return null;
  return {
    ...res.rows[0],
    amount: BigInt(res.rows[0].amount),
  };
}

/**
 * Menghapus transaksi (soft-delete).
 * @param {number|bigint} id
 * @param {object} [opts]
 * @param {string} [opts.botReplyId]
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<object>}
 */
export async function deleteTransaction(id, opts = {}, client = pool) {
  const existing = await getTransactionById(id, client);
  if (!existing || existing.deleted_at) {
    throw new Error(`Transaksi #${id} tidak ditemukan atau sudah dibatalkan.`);
  }

  const res = await client.query(
    'UPDATE transactions SET deleted_at = now() WHERE id = $1 RETURNING *',
    [id]
  );
  const deleted = res.rows[0];

  // Catat di action_log
  await client.query(
    `INSERT INTO action_log (entity, entity_id, action, before_data, after_data, bot_reply_id)
     VALUES ('transaction', $1, 'delete', $2, $3, $4)`,
    [id, safeJson(existing), safeJson(deleted), opts.botReplyId || null]
  );

  // Jika transaksi yang dihapus adalah uang bulanan, hitung ulang alokasi
  if (existing.is_monthly_income) {
    await recalculateMonthlyAllocations(existing.period_id, client);
  }

  return deleted;
}

/**
 * Memperbarui transaksi (koreksi / ralat).
 * Menyimpan nilai lama di action_log.before_data untuk keperluan audit/undo.
 * @param {number|bigint} id
 * @param {object} patch
 * @param {number|bigint} [patch.amount]
 * @param {number} [patch.categoryId]
 * @param {number} [patch.pocketId]
 * @param {string} [patch.note]
 * @param {object} [opts]
 * @param {string} [opts.botReplyId]
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<object>}
 */
export async function updateTransaction(id, patch, opts = {}, client = pool) {
  const existing = await getTransactionById(id, client);
  if (!existing || existing.deleted_at) {
    throw new Error(`Transaksi #${id} tidak ditemukan.`);
  }

  const updates = [];
  const values = [];

  if (patch.amount !== undefined) {
    const num = typeof patch.amount === 'bigint' ? patch.amount : BigInt(Math.round(Number(patch.amount)));
    values.push(num.toString());
    updates.push(`amount = $${values.length}`);
  }
  if (patch.categoryId !== undefined) {
    values.push(patch.categoryId);
    updates.push(`category_id = $${values.length}`);
  }
  if (patch.pocketId !== undefined) {
    values.push(patch.pocketId);
    updates.push(`pocket_id = $${values.length}`);
  }
  if (patch.note !== undefined) {
    values.push(patch.note);
    updates.push(`note = $${values.length}`);
  }

  if (updates.length === 0) return existing;

  updates.push('updated_at = now()');
  values.push(id);

  const sql = `UPDATE transactions SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`;
  const res = await client.query(sql, values);
  const updated = res.rows[0];

  // Catat di action_log
  await client.query(
    `INSERT INTO action_log (entity, entity_id, action, before_data, after_data, bot_reply_id)
     VALUES ('transaction', $1, 'update', $2, $3, $4)`,
    [id, safeJson(existing), safeJson(updated), opts.botReplyId || null]
  );

  // Jika yang diubah uang bulanan, hitung ulang alokasi
  if (existing.is_monthly_income) {
    await recalculateMonthlyAllocations(existing.period_id, client);
  }

  return {
    ...updated,
    amount: BigInt(updated.amount),
  };
}

/**
 * Hitung ulang alokasi uang bulanan di suatu periode.
 * @param {number} periodId
 * @param {import('pg').PoolClient} [client]
 */
async function recalculateMonthlyAllocations(periodId, client = pool) {
  const incomeRes = await client.query(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM transactions
     WHERE period_id = $1 AND is_monthly_income = TRUE AND deleted_at IS NULL`,
    [periodId]
  );
  const totalMonthlyIncome = BigInt(incomeRes.rows[0].total || 0);

  const ppRes = await client.query(
    'SELECT pocket_id, alloc_percent FROM period_pockets WHERE period_id = $1',
    [periodId]
  );

  for (const row of ppRes.rows) {
    const percent = parseFloat(row.alloc_percent) || 0;
    const allocAmount =
      percent > 0 && totalMonthlyIncome > 0n
        ? (BigInt(Math.floor(percent * 100)) * totalMonthlyIncome) / 10000n
        : 0n;

    await client.query(
      'UPDATE period_pockets SET alloc_amount = $1 WHERE period_id = $2 AND pocket_id = $3',
      [allocAmount.toString(), periodId, row.pocket_id]
    );
  }
}
