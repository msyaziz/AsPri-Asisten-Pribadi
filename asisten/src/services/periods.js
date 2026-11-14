/**
 * Service Periode & Saldo.
 * Sesuai prd.md §8.2, §8.3, §9.3-9.5 dan 02-fase2-keuangan-inti.md.
 */

import { pool } from '../db/pool.js';
import { nowWib } from '../utils/time.js';

/**
 * Memastikan baris periode untuk bulan & tahun tertentu ada di database.
 * Jika baru dibuat, secara otomatis menginisialisasi baris di `period_pockets`
 * untuk semua kantong yang aktif.
 * @param {number} year
 * @param {number} month (1-12)
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<object>} Baris periode
 */
export async function ensurePeriod(year, month, client = pool) {
  // Cek apakah sudah ada
  const findRes = await client.query(
    'SELECT * FROM periods WHERE year = $1 AND month = $2',
    [year, month]
  );
  if (findRes.rows.length > 0) {
    return findRes.rows[0];
  }

  // Buat periode baru
  const insertRes = await client.query(
    `INSERT INTO periods (year, month, status, main_opening)
     VALUES ($1, $2, 'open', 0)
     ON CONFLICT (year, month) DO UPDATE SET status = periods.status
     RETURNING *`,
    [year, month]
  );
  const period = insertRes.rows[0];

  // Inisialisasi period_pockets untuk semua kantong aktif
  // Cek alokasi default atau alokasi dari periode sebelumnya jika ada
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevPeriodRes = await client.query(
    'SELECT id FROM periods WHERE year = $1 AND month = $2',
    [prevYear, prevMonth]
  );

  const prevPeriodId = prevPeriodRes.rows[0]?.id;

  const pocketsRes = await client.query(
    'SELECT id FROM pockets WHERE is_active = TRUE ORDER BY sort_order, id'
  );

  for (const pocket of pocketsRes.rows) {
    let allocPercent = null;
    if (prevPeriodId) {
      const prevPp = await client.query(
        'SELECT alloc_percent FROM period_pockets WHERE period_id = $1 AND pocket_id = $2',
        [prevPeriodId, pocket.id]
      );
      if (prevPp.rows.length > 0) {
        allocPercent = prevPp.rows[0].alloc_percent;
      }
    }

    await client.query(
      `INSERT INTO period_pockets (period_id, pocket_id, alloc_percent, alloc_amount, rollover_in)
       VALUES ($1, $2, $3, 0, 0)
       ON CONFLICT (period_id, pocket_id) DO NOTHING`,
      [period.id, pocket.id, allocPercent]
    );
  }

  return period;
}

/**
 * Memastikan periode untuk bulan kalender berjalan (WIB) tersedia.
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<object>}
 */
export async function ensureCurrentPeriod(client = pool) {
  const dt = nowWib();
  return ensurePeriod(dt.year, dt.month, client);
}

/**
 * Mendapatkan atau memastikan periode berdasarkan string tanggal YYYY-MM-DD.
 * @param {string} dateStr Format YYYY-MM-DD
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<object>}
 */
export async function getPeriodByDate(dateStr, client = pool) {
  const [yearStr, monthStr] = dateStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  return ensurePeriod(year, month, client);
}

/**
 * Mendapatkan periode berdasarkan ID.
 * @param {number} id
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<object|null>}
 */
export async function getPeriodById(id, client = pool) {
  const res = await client.query('SELECT * FROM periods WHERE id = $1', [id]);
  return res.rows[0] || null;
}

/**
 * Mendapatkan saldo utama dari view `v_main_balance`.
 * @param {number} periodId
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<bigint>}
 */
export async function getMainBalance(periodId, client = pool) {
  const res = await client.query(
    'SELECT main_balance FROM v_main_balance WHERE period_id = $1',
    [periodId]
  );
  if (res.rows.length === 0) return 0n;
  return BigInt(res.rows[0].main_balance || 0);
}

/**
 * Menghitung total semua uang (saldo utama + seluruh kantong).
 * @param {number} periodId
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<{ mainBalance: bigint, pocketTotal: bigint, grandTotal: bigint }>}
 */
export async function getTotalMoney(periodId, client = pool) {
  const mainBalance = await getMainBalance(periodId, client);
  const pocketsRes = await client.query(
    'SELECT COALESCE(SUM(balance), 0) AS total FROM v_pocket_balance WHERE period_id = $1',
    [periodId]
  );
  const pocketTotal = BigInt(pocketsRes.rows[0]?.total || 0);
  return {
    mainBalance,
    pocketTotal,
    grandTotal: mainBalance + pocketTotal,
  };
}
