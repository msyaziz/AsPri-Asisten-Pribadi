import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { getSpendingReport, getMonthlyFinancialReport } from '../../services/reports.js';
import { formatWibDate } from '../../utils/time.js';

export const reportsRouter = Router();
export const exportRouter = Router();

// GET /api/reports/by-category?from=&to=
reportsRouter.get('/by-category', async (req, res) => {
  try {
    const from = req.query.from;
    const to = req.query.to;
    const report = await getSpendingReport({ dateFrom: from, dateTo: to });
    res.json({ ok: true, data: report });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: { code: 'REPORT_BY_CATEGORY_FAILED', message: err.message },
    });
  }
});

// GET /api/reports/trend?months=6
reportsRouter.get('/trend', async (req, res) => {
  try {
    const months = Math.min(Math.max(Number(req.query.months) || 6, 1), 24);
    const query = `
      SELECT p.year, p.month,
             COALESCE(SUM(CASE WHEN t.type = 'masuk' THEN t.amount ELSE 0 END), 0)::bigint AS income,
             COALESCE(SUM(CASE WHEN t.type = 'keluar' THEN t.amount ELSE 0 END), 0)::bigint AS expense
      FROM periods p
      LEFT JOIN transactions t ON t.period_id = p.id AND t.deleted_at IS NULL
      GROUP BY p.year, p.month
      ORDER BY p.year DESC, p.month DESC
      LIMIT $1
    `;
    const result = await pool.query(query, [months]);
    const trend = result.rows.reverse().map((r) => ({
      period: `${r.year}-${String(r.month).padStart(2, '0')}`,
      income: Number(r.income),
      expense: Number(r.expense),
    }));
    res.json({ ok: true, data: trend });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: { code: 'REPORT_TREND_FAILED', message: err.message },
    });
  }
});

// GET /api/reports/monthly?period=YYYY-MM
reportsRouter.get('/monthly', async (req, res) => {
  try {
    let year, month;
    if (req.query.period && /^\d{4}-\d{2}$/.test(req.query.period)) {
      const parts = req.query.period.split('-').map(Number);
      year = parts[0];
      month = parts[1];
    }
    const report = await getMonthlyFinancialReport({ year, month });
    res.json({ ok: true, data: report });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: { code: 'REPORT_MONTHLY_FAILED', message: err.message },
    });
  }
});

function escapeCsvField(field) {
  if (field === null || field === undefined) return '';
  const str = String(field);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// GET /api/export/transactions.csv?from=&to=
exportRouter.get('/transactions.csv', async (req, res) => {
  try {
    const from = req.query.from;
    const to = req.query.to;
    const conditions = ['t.deleted_at IS NULL'];
    const values = [];

    if (from) {
      values.push(from);
      conditions.push(`t.tx_date >= $${values.length}`);
    }
    if (to) {
      values.push(to);
      conditions.push(`t.tx_date <= $${values.length}`);
    }

    const query = `
      SELECT t.id, t.tx_date, t.type, t.amount,
             COALESCE(c.name, '') AS category_name,
             COALESCE(p.name, 'Saldo Utama') AS pocket_name,
             COALESCE(t.note, '') AS note,
             t.source,
             t.created_at
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN pockets p ON p.id = t.pocket_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY t.tx_date DESC, t.id DESC
    `;

    const result = await pool.query(query, values);

    // CSV UTF-8 BOM
    const BOM = '\uFEFF';
    const headers = ['ID', 'Tanggal', 'Tipe', 'Nominal', 'Kategori', 'Kantong', 'Catatan', 'Sumber'];
    const rows = [headers.join(',')];

    for (const r of result.rows) {
      const row = [
        escapeCsvField(r.id),
        escapeCsvField(r.tx_date instanceof Date ? r.tx_date.toISOString().split('T')[0] : r.tx_date),
        escapeCsvField(r.type),
        escapeCsvField(r.amount),
        escapeCsvField(r.category_name),
        escapeCsvField(r.pocket_name),
        escapeCsvField(r.note),
        escapeCsvField(r.source),
      ];
      rows.push(row.join(','));
    }

    const csvBuffer = Buffer.concat([
      Buffer.from([0xEF, 0xBB, 0xBF]),
      Buffer.from(rows.join('\r\n'), 'utf-8'),
    ]);
    const filename = `transaksi_${from || 'awal'}_${to || 'akhir'}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvBuffer);
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: { code: 'EXPORT_CSV_FAILED', message: err.message },
    });
  }
});
