/**
 * Service Kantong & Alokasi.
 * Sesuai prd.md §8.2, §8.3, §9.3-9.5 dan 02-fase2-keuangan-inti.md.
 */

import { pool } from '../db/pool.js';

/**
 * Mengambil semua kantong aktif.
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<Array<object>>}
 */
export async function getActivePockets(client = pool) {
  const res = await client.query(
    'SELECT * FROM pockets WHERE is_active = TRUE ORDER BY sort_order, id'
  );
  return res.rows;
}

/**
 * Mencari kantong berdasarkan nama (case-insensitive).
 * @param {string} name
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<object|null>}
 */
export async function getPocketByName(name, client = pool) {
  if (!name) return null;
  const res = await client.query(
    'SELECT * FROM pockets WHERE LOWER(name) = LOWER($1)',
    [name.trim()]
  );
  return res.rows[0] || null;
}

/**
 * Mencari kantong berdasarkan ID.
 * @param {number} id
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<object|null>}
 */
export async function getPocketById(id, client = pool) {
  const res = await client.query('SELECT * FROM pockets WHERE id = $1', [id]);
  return res.rows[0] || null;
}

/**
 * Mengambil saldo seluruh kantong pada periode tertentu dari view `v_pocket_balance`.
 * @param {number} periodId
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<Array<object>>}
 */
export async function getPocketBalances(periodId, client = pool) {
  const res = await client.query(
    `SELECT
       period_id, pocket_id, pocket_name,
       rollover_in::bigint, alloc_amount::bigint,
       income_direct::bigint, transfer_in::bigint,
       transfer_out::bigint, spent::bigint,
       balance::bigint
     FROM v_pocket_balance
     WHERE period_id = $1
     ORDER BY pocket_id`,
    [periodId]
  );
  return res.rows.map((r) => ({
    periodId: r.period_id,
    pocketId: r.pocket_id,
    pocketName: r.pocket_name,
    rolloverIn: BigInt(r.rollover_in),
    allocAmount: BigInt(r.alloc_amount),
    incomeDirect: BigInt(r.income_direct),
    transferIn: BigInt(r.transfer_in),
    transferOut: BigInt(r.transfer_out),
    spent: BigInt(r.spent),
    balance: BigInt(r.balance),
  }));
}

/**
 * Mengambil saldo satu kantong pada periode tertentu.
 * @param {number} periodId
 * @param {number} pocketId
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<object|null>}
 */
export async function getPocketBalance(periodId, pocketId, client = pool) {
  const res = await client.query(
    `SELECT
       period_id, pocket_id, pocket_name,
       rollover_in::bigint, alloc_amount::bigint,
       income_direct::bigint, transfer_in::bigint,
       transfer_out::bigint, spent::bigint,
       balance::bigint
     FROM v_pocket_balance
     WHERE period_id = $1 AND pocket_id = $2`,
    [periodId, pocketId]
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    periodId: r.period_id,
    pocketId: r.pocket_id,
    pocketName: r.pocket_name,
    rolloverIn: BigInt(r.rollover_in),
    allocAmount: BigInt(r.alloc_amount),
    incomeDirect: BigInt(r.income_direct),
    transferIn: BigInt(r.transfer_in),
    transferOut: BigInt(r.transfer_out),
    spent: BigInt(r.spent),
    balance: BigInt(r.balance),
  };
}

/**
 * Membuat kantong baru.
 * @param {object} param
 * @param {string} param.name
 * @param {number} [param.sortOrder=0]
 * @param {'carry'|'return'} [param.rolloverMode='carry']
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<object>}
 */
export async function createPocket(
  { name, sortOrder = 0, rolloverMode = 'carry' },
  client = pool
) {
  const trimmed = name.trim();
  const res = await client.query(
    `INSERT INTO pockets (name, sort_order, rollover_mode)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [trimmed, sortOrder, rolloverMode]
  );
  const pocket = res.rows[0];

  // Inisialisasi di semua periode terbuka (open)
  const openPeriods = await client.query("SELECT id FROM periods WHERE status = 'open'");
  for (const pr of openPeriods.rows) {
    await client.query(
      `INSERT INTO period_pockets (period_id, pocket_id, alloc_percent, alloc_amount, rollover_in)
       VALUES ($1, $2, 0, 0, 0)
       ON CONFLICT (period_id, pocket_id) DO NOTHING`,
      [pr.id, pocket.id]
    );
  }

  return pocket;
}

/**
 * Mengubah nama kantong.
 * @param {number} id
 * @param {string} newName
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<object>}
 */
export async function renamePocket(id, newName, client = pool) {
  const res = await client.query(
    'UPDATE pockets SET name = $1 WHERE id = $2 RETURNING *',
    [newName.trim(), id]
  );
  if (res.rows.length === 0) {
    throw new Error(`Kantong dengan ID ${id} tidak ditemukan.`);
  }
  return res.rows[0];
}

/**
 * Mengatur status aktif/non-aktif kantong.
 * @param {number} id
 * @param {boolean} isActive
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<object>}
 */
export async function setPocketActive(id, isActive, client = pool) {
  const res = await client.query(
    'UPDATE pockets SET is_active = $1 WHERE id = $2 RETURNING *',
    [isActive, id]
  );
  if (res.rows.length === 0) {
    throw new Error(`Kantong dengan ID ${id} tidak ditemukan.`);
  }
  return res.rows[0];
}

/**
 * Mengubah mode rollover kantong ('carry' | 'return').
 * @param {number|string} idOrName ID atau nama kantong
 * @param {'carry'|'return'} mode
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<object>}
 */
export async function setRolloverMode(idOrName, mode, client = pool) {
  if (mode !== 'carry' && mode !== 'return') {
    throw new Error(`Mode rollover tidak valid: ${mode}. Gunakan 'carry' atau 'return'.`);
  }

  let res;
  if (typeof idOrName === 'number') {
    res = await client.query(
      'UPDATE pockets SET rollover_mode = $1 WHERE id = $2 RETURNING *',
      [mode, idOrName]
    );
  } else {
    res = await client.query(
      'UPDATE pockets SET rollover_mode = $1 WHERE LOWER(name) = LOWER($2) RETURNING *',
      [mode, idOrName.trim()]
    );
  }

  if (res.rows.length === 0) {
    throw new Error(`Kantong '${idOrName}' tidak ditemukan.`);
  }
  return res.rows[0];
}

/**
 * Mengatur alokasi persentase/nominal untuk kantong-kantong di suatu periode.
 * Menghitung ulang `alloc_amount = FLOOR(persen/100 * total_uang_bulanan)` jika sudah ada uang bulanan.
 * Total persentase seluruh kantong tidak boleh melebihi 100%.
 * @param {number} periodId
 * @param {Array<{ pocketId?: number, pocketName?: string, percent?: number, amount?: number }>} items
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<{ updatedPockets: Array<object>, totalPercent: number }>}
 */
export async function setAllocations(periodId, items, client = pool) {
  // 1. Ambil semua baris period_pockets untuk periode ini
  const existingRes = await client.query(
    `SELECT pp.pocket_id, p.name AS pocket_name, pp.alloc_percent, pp.alloc_amount
     FROM period_pockets pp
     JOIN pockets p ON p.id = pp.pocket_id
     WHERE pp.period_id = $1`,
    [periodId]
  );

  const pocketMap = new Map();
  for (const row of existingRes.rows) {
    pocketMap.set(row.pocket_id, {
      id: row.pocket_id,
      name: row.pocket_name,
      percent: parseFloat(row.alloc_percent) || 0,
      amount: BigInt(row.alloc_amount || 0),
    });
  }

  // 2. Terapkan update dari items ke map
  for (const item of items) {
    let pocketId = item.pocketId;
    if (!pocketId && item.pocketName) {
      const p = await getPocketByName(item.pocketName, client);
      if (!p) throw new Error(`Kantong '${item.pocketName}' tidak ditemukan.`);
      pocketId = p.id;
    }

    if (!pocketMap.has(pocketId)) {
      // Pastikan ada di period_pockets
      const p = await getPocketById(pocketId, client);
      if (!p) throw new Error(`Kantong dengan ID ${pocketId} tidak ditemukan.`);
      pocketMap.set(pocketId, {
        id: pocketId,
        name: p.name,
        percent: 0,
        amount: 0n,
      });
    }

    const target = pocketMap.get(pocketId);
    if (item.percent !== undefined && item.percent !== null) {
      target.percent = parseFloat(item.percent);
    }
    if (item.amount !== undefined && item.amount !== null) {
      target.amount = BigInt(Math.round(item.amount));
    }
  }

  // 3. Validasi: total persen <= 100%
  let totalPercent = 0;
  for (const p of pocketMap.values()) {
    totalPercent += p.percent;
  }
  // Toleransi floating point 0.001
  if (totalPercent > 100.001) {
    throw new Error(
      `Total alokasi melebihi 100% (saat ini ${totalPercent.toFixed(1)}%). Harap kurangi persentase.`
    );
  }

  // 4. Hitung total uang bulanan di periode ini
  const incomeRes = await client.query(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM transactions
     WHERE period_id = $1 AND is_monthly_income = TRUE AND deleted_at IS NULL`,
    [periodId]
  );
  const totalMonthlyIncome = BigInt(incomeRes.rows[0].total || 0);

  // 5. Simpan ke database
  const updatedPockets = [];
  for (const p of pocketMap.values()) {
    let allocAmount = p.amount;
    if (p.percent > 0 && totalMonthlyIncome > 0n) {
      // alloc_amount = FLOOR(persen/100 * uang_bulanan)
      allocAmount = (BigInt(Math.floor(p.percent * 100)) * totalMonthlyIncome) / 10000n;
    }

    await client.query(
      `INSERT INTO period_pockets (period_id, pocket_id, alloc_percent, alloc_amount)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (period_id, pocket_id)
       DO UPDATE SET alloc_percent = $3, alloc_amount = $4`,
      [periodId, p.id, p.percent, allocAmount.toString()]
    );

    updatedPockets.push({
      pocketId: p.id,
      pocketName: p.name,
      allocPercent: p.percent,
      allocAmount,
    });
  }

  return {
    updatedPockets,
    totalPercent,
  };
}
