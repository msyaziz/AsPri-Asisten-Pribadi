/**
 * Service Laporan Keuangan & Tanya Data.
 * Sesuai prd.md §10, §12.4 dan 03-fase3-ai-agent-lanjutan.md.
 */

import { pool } from '../db/pool.js';
import { resolveSymbolicDateRange, nowWib } from '../utils/time.js';
import { ensurePeriod, getMainBalance, getTotalMoney } from './periods.js';
import { getPocketBalances, getPocketByName } from './pockets.js';
import { getCategoryByName } from './categories.js';

/**
 * Mengambil ringkasan pengeluaran berdasarkan rentang waktu, kategori, atau kantong.
 * @param {object} [params]
 * @param {string} [params.range] 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month'
 * @param {string} [params.dateFrom]
 * @param {string} [params.dateTo]
 * @param {string|number} [params.category]
 * @param {string|number} [params.pocket]
 * @returns {Promise<object>}
 */
export async function getSpendingReport(params = {}) {
  const { range, dateFrom, dateTo, category, pocket } = params;
  const { from, to, label } = resolveSymbolicDateRange(range, dateFrom, dateTo);

  let categoryId = null;
  if (category) {
    if (typeof category === 'number') {
      categoryId = category;
    } else {
      const cat = await getCategoryByName(category);
      if (cat) categoryId = cat.id;
    }
  }

  let pocketId = null;
  if (pocket) {
    if (typeof pocket === 'number') {
      pocketId = pocket;
    } else {
      const p = await getPocketByName(pocket);
      if (p) pocketId = p.id;
    }
  }

  // 1. Total per kategori
  const catQuery = `
    SELECT COALESCE(c.name, 'Tanpa Kategori') AS category_name,
           SUM(t.amount)::bigint AS total,
           COUNT(t.id)::int AS count
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.type = 'keluar' AND t.deleted_at IS NULL
      AND t.tx_date BETWEEN $1 AND $2
      AND ($3::int IS NULL OR t.category_id = $3)
      AND ($4::int IS NULL OR t.pocket_id = $4)
    GROUP BY c.name
    ORDER BY total DESC
  `;
  const catRes = await pool.query(catQuery, [from, to, categoryId, pocketId]);

  let totalSpending = 0n;
  const byCategory = catRes.rows.map((r) => {
    const tot = BigInt(r.total);
    totalSpending += tot;
    return {
      category: r.category_name,
      total: Number(tot),
      count: r.count,
    };
  });

  // 2. Daftar transaksi ringkas (maks 10 terbaru)
  const itemsQuery = `
    SELECT t.id, t.amount, t.note, t.tx_date,
           COALESCE(c.name, '-') AS category_name,
           COALESCE(p.name, 'Utama') AS pocket_name
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN pockets p ON p.id = t.pocket_id
    WHERE t.type = 'keluar' AND t.deleted_at IS NULL
      AND t.tx_date BETWEEN $1 AND $2
      AND ($3::int IS NULL OR t.category_id = $3)
      AND ($4::int IS NULL OR t.pocket_id = $4)
    ORDER BY t.tx_date DESC, t.id DESC
    LIMIT 10
  `;
  const itemsRes = await pool.query(itemsQuery, [from, to, categoryId, pocketId]);
  const items = itemsRes.rows.map((r) => ({
    id: r.id,
    amount: Number(r.amount),
    note: r.note,
    date: r.tx_date,
    category: r.category_name,
    pocket: r.pocket_name,
  }));

  return {
    period: label,
    dateFrom: from,
    dateTo: to,
    totalSpending: Number(totalSpending),
    byCategory,
    recentTransactions: items,
  };
}

/**
 * Mengambil ringkasan pemasukan berdasarkan rentang waktu.
 * @param {object} [params]
 * @param {string} [params.range]
 * @param {string} [params.dateFrom]
 * @param {string} [params.dateTo]
 * @returns {Promise<object>}
 */
export async function getIncomeReport(params = {}) {
  const { range, dateFrom, dateTo } = params;
  const { from, to, label } = resolveSymbolicDateRange(range, dateFrom, dateTo);

  const query = `
    SELECT COALESCE(c.name, 'Pemasukan') AS category_name,
           SUM(t.amount)::bigint AS total,
           COUNT(t.id)::int AS count
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.type = 'masuk' AND t.deleted_at IS NULL
      AND t.tx_date BETWEEN $1 AND $2
    GROUP BY c.name
    ORDER BY total DESC
  `;
  const res = await pool.query(query, [from, to]);

  let totalIncome = 0n;
  const byCategory = res.rows.map((r) => {
    const tot = BigInt(r.total);
    totalIncome += tot;
    return {
      category: r.category_name,
      total: Number(tot),
      count: r.count,
    };
  });

  return {
    period: label,
    dateFrom: from,
    dateTo: to,
    totalIncome: Number(totalIncome),
    byCategory,
  };
}

/**
 * Mengambil daftar riwayat transaksi.
 * @param {object} [params]
 * @param {string} [params.range]
 * @param {string} [params.dateFrom]
 * @param {string} [params.dateTo]
 * @param {number} [params.limit=10]
 * @param {string} [params.type] 'masuk' | 'keluar'
 * @param {string|number} [params.pocket]
 * @param {string|number} [params.category]
 * @returns {Promise<object>}
 */
export async function listTransactionsReport(params = {}) {
  const { range, dateFrom, dateTo, limit = 10, type, pocket, category } = params;
  const { from, to, label } = resolveSymbolicDateRange(range, dateFrom, dateTo);

  let categoryId = null;
  if (category) {
    if (typeof category === 'number') categoryId = category;
    else {
      const cat = await getCategoryByName(category);
      if (cat) categoryId = cat.id;
    }
  }

  let pocketId = null;
  if (pocket) {
    if (typeof pocket === 'number') pocketId = pocket;
    else {
      const p = await getPocketByName(pocket);
      if (p) pocketId = p.id;
    }
  }

  const query = `
    SELECT t.id, t.type, t.amount, t.note, t.tx_date,
           COALESCE(c.name, '-') AS category_name,
           COALESCE(p.name, 'Utama') AS pocket_name
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN pockets p ON p.id = t.pocket_id
    WHERE t.deleted_at IS NULL
      AND t.tx_date BETWEEN $1 AND $2
      AND ($3::text IS NULL OR t.type = $3)
      AND ($4::int IS NULL OR t.category_id = $4)
      AND ($5::int IS NULL OR t.pocket_id = $5)
    ORDER BY t.tx_date DESC, t.id DESC
    LIMIT $6
  `;
  const res = await pool.query(query, [from, to, type || null, categoryId, pocketId, limit]);

  const transactions = res.rows.map((r) => ({
    id: r.id,
    type: r.type,
    amount: Number(r.amount),
    note: r.note,
    date: r.tx_date,
    category: r.category_name,
    pocket: r.pocket_name,
  }));

  return {
    period: label,
    dateFrom: from,
    dateTo: to,
    count: transactions.length,
    transactions,
  };
}

/**
 * Mengambil laporan bulanan lengkap.
 * @param {object} [params]
 * @param {number} [params.year]
 * @param {number} [params.month]
 * @returns {Promise<object>}
 */
export async function getMonthlyFinancialReport(params = {}) {
  const dt = nowWib();
  const year = params.year || dt.year;
  const month = params.month || dt.month;

  const period = await ensurePeriod(year, month);
  const totalMoney = await getTotalMoney(period.id);
  const pockets = await getPocketBalances(period.id);

  // Pemasukan & pengeluaran di periode ini
  const flowQuery = `
    SELECT type, SUM(amount)::bigint AS total
    FROM transactions
    WHERE period_id = $1 AND deleted_at IS NULL
    GROUP BY type
  `;
  const flowRes = await pool.query(flowQuery, [period.id]);
  let income = 0;
  let spending = 0;
  for (const r of flowRes.rows) {
    if (r.type === 'masuk') income = Number(r.total);
    if (r.type === 'keluar') spending = Number(r.total);
  }

  // Pengeluaran per kategori
  const catQuery = `
    SELECT COALESCE(c.name, 'Lainnya') AS category_name, SUM(t.amount)::bigint AS total
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.period_id = $1 AND t.type = 'keluar' AND t.deleted_at IS NULL
    GROUP BY c.name
    ORDER BY total DESC
  `;
  const catRes = await pool.query(catQuery, [period.id]);
  const spendingByCategory = catRes.rows.map((r) => ({
    category: r.category_name,
    total: Number(r.total),
  }));

  return {
    period: `${year}-${String(month).padStart(2, '0')}`,
    grandTotal: Number(totalMoney.grandTotal),
    mainBalance: Number(totalMoney.mainBalance),
    pocketsTotal: Number(totalMoney.pocketsTotal),
    income,
    spending,
    pockets: pockets.map((p) => ({
      name: p.name,
      balance: Number(p.currentBalance),
      rolloverMode: p.rolloverMode,
    })),
    spendingByCategory,
  };
}
