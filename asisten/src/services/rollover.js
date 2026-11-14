/**
 * Service Rollover & Penutupan Periode (closePeriod).
 * Sesuai prd.md §8.4, §9.6 dan 02-fase2-keuangan-inti.md.
 */

import { pool } from '../db/pool.js';
import { ensurePeriod } from './periods.js';
import { formatRupiah } from '../utils/rupiah.js';

/**
 * Menutup suatu periode dan mengeksekusi perhitungan rollover ke periode berikutnya.
 * Prosedur ini idempoten dan berjalan dalam satu transaksi database dengan row-level lock.
 *
 * @param {number} periodId
 * @param {object} [opts]
 * @param {import('pg').PoolClient} [opts.client]
 * @returns {Promise<object>} Ringkasan hasil penutupan periode
 */
export async function closePeriod(periodId, opts = {}) {
  const useExternalClient = Boolean(opts.client);
  const client = opts.client || (await pool.connect());

  try {
    if (!useExternalClient) {
      await client.query('BEGIN');
    }

    // 1. Lock baris periode saat ini
    const pRes = await client.query(
      'SELECT * FROM periods WHERE id = $1 FOR UPDATE',
      [periodId]
    );
    const period = pRes.rows[0];
    if (!period) {
      throw new Error(`Periode dengan ID ${periodId} tidak ditemukan.`);
    }

    // Idempoten: Jika sudah berstatus 'closed', kembalikan tanpa memproses ulang
    if (period.status === 'closed') {
      if (!useExternalClient) await client.query('COMMIT');
      return {
        alreadyClosed: true,
        periodId: period.id,
        year: period.year,
        month: period.month,
      };
    }

    // 2. Hitung bulan & tahun berikutnya
    const nextMonth = period.month === 12 ? 1 : period.month + 1;
    const nextYear = period.month === 12 ? period.year + 1 : period.year;

    // Pastikan periode berikutnya ada
    const nextPeriod = await ensurePeriod(nextYear, nextMonth, client);
    await client.query('SELECT * FROM periods WHERE id = $1 FOR UPDATE', [nextPeriod.id]);

    // 3. Ambil sisa Saldo Utama saat ini dari v_main_balance
    const mainBalRes = await client.query(
      'SELECT main_balance FROM v_main_balance WHERE period_id = $1',
      [periodId]
    );
    let mainCarry = BigInt(mainBalRes.rows[0]?.main_balance || 0);

    // 4. Ambil saldo tiap kantong dari v_pocket_balance
    const pocketsRes = await client.query(
      `SELECT
         v.pocket_id,
         v.pocket_name,
         v.balance,
         p.rollover_mode,
         pp.alloc_percent
       FROM v_pocket_balance v
       JOIN pockets p ON p.id = v.pocket_id
       JOIN period_pockets pp ON pp.period_id = v.period_id AND pp.pocket_id = v.pocket_id
       WHERE v.period_id = $1
       ORDER BY p.sort_order, p.id`,
      [periodId]
    );

    const pocketsSummary = [];

    for (const row of pocketsRes.rows) {
      const balance = BigInt(row.balance);
      const mode = row.rollover_mode; // 'carry' atau 'return'
      let rolloverIn = 0n;
      let actionTaken = 'none';

      // (1) Catat closing_balance snapshot pada periode yang ditutup
      await client.query(
        'UPDATE period_pockets SET closing_balance = $1 WHERE period_id = $2 AND pocket_id = $3',
        [balance.toString(), periodId, row.pocket_id]
      );

      // (2) Terapkan aturan rollover berdasarkan sisa saldo
      if (balance > 0n) {
        if (mode === 'carry') {
          // (a) carry: Sisa positif dibawa ke kantong yang sama di bulan berikutnya
          rolloverIn = balance;
          actionTaken = 'carry_to_next';
        } else {
          // (b) return: Sisa positif dikembalikan ke saldo utama bulan berikutnya
          mainCarry += balance;
          rolloverIn = 0n;
          actionTaken = 'return_to_main';
        }
      } else if (balance < 0n) {
        // (c) Sisa negatif (defisit): TIDAK dibawa, defisit mengurangi saldo utama bulan depan
        mainCarry += balance; // balance negatif, jadi mainCarry berkurang
        rolloverIn = 0n;
        actionTaken = 'deficit_to_main';
      } else {
        // balance === 0
        rolloverIn = 0n;
        actionTaken = 'zero_balance';
      }

      // (3) Siapkan baris kantong bulan depan (salin alloc_percent, reset alloc_amount = 0)
      await client.query(
        `INSERT INTO period_pockets (period_id, pocket_id, alloc_percent, alloc_amount, rollover_in)
         VALUES ($1, $2, $3, 0, $4)
         ON CONFLICT (period_id, pocket_id)
         DO UPDATE SET
           alloc_percent = EXCLUDED.alloc_percent,
           rollover_in   = EXCLUDED.rollover_in`,
        [nextPeriod.id, row.pocket_id, row.alloc_percent, rolloverIn.toString()]
      );

      pocketsSummary.push({
        pocketId: row.pocket_id,
        pocketName: row.pocket_name,
        closingBalance: balance,
        rolloverMode: mode,
        rolloverIn,
        actionTaken,
      });
    }

    // 5. Perbarui main_opening periode berikutnya
    await client.query(
      'UPDATE periods SET main_opening = $1 WHERE id = $2',
      [mainCarry.toString(), nextPeriod.id]
    );

    // 6. Tutup periode saat ini
    await client.query(
      "UPDATE periods SET status = 'closed', closed_at = now() WHERE id = $1",
      [periodId]
    );

    if (!useExternalClient) {
      await client.query('COMMIT');
    }

    return {
      alreadyClosed: false,
      periodId: period.id,
      year: period.year,
      month: period.month,
      nextPeriodId: nextPeriod.id,
      nextYear,
      nextMonth,
      mainCarry,
      pocketsSummary,
    };
  } catch (err) {
    if (!useExternalClient) {
      await client.query('ROLLBACK');
    }
    throw err;
  } finally {
    if (!useExternalClient) {
      client.release();
    }
  }
}

/**
 * Memastikan semua periode sebelum bulan berjalan yang masih 'open' ditutup secara berurutan (Lazy Closure).
 * @param {number} currentYear
 * @param {number} currentMonth
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<Array<object>>} Daftar periode yang ditutup
 */
export async function ensurePreviousPeriodsClosed(currentYear, currentMonth, client = pool) {
  const openRes = await client.query(
    `SELECT id, year, month FROM periods
     WHERE status = 'open'
       AND (year < $1 OR (year = $1 AND month < $2))
     ORDER BY year ASC, month ASC`,
    [currentYear, currentMonth]
  );

  const results = [];
  for (const pr of openRes.rows) {
    const res = await closePeriod(pr.id);
    results.push(res);
  }
  return results;
}

/**
 * Format ringkasan hasil rollover untuk balasan WhatsApp atau pesan pengumuman.
 * @param {object} summary
 * @returns {string}
 */
export function formatRolloverSummary(summary) {
  if (summary.alreadyClosed) {
    return `Periode ${summary.month}/${summary.year} sudah ditutup sebelumnya.`;
  }

  const lines = [
    `📊 *Tutup Buku & Rollover: ${summary.month}/${summary.year}*`,
    `Tutup buku berhasil diproses ke periode ${summary.nextMonth}/${summary.nextYear}.`,
    '',
    `🏦 *Saldo Utama Dibawa (main_opening):* ${formatRupiah(summary.mainCarry)}`,
    '',
    '*Rincian Kantong:*',
  ];

  for (const p of summary.pocketsSummary) {
    let note = '';
    if (p.actionTaken === 'carry_to_next') {
      note = `➡️ Dibawa ke bulan depan (${formatRupiah(p.rolloverIn)})`;
    } else if (p.actionTaken === 'return_to_main') {
      note = '↩️ Masuk ke Saldo Utama';
    } else if (p.actionTaken === 'deficit_to_main') {
      note = '⚠️ Defisit dibebankan ke Saldo Utama, kantong reset ke 0';
    } else {
      note = 'Saldo Rp 0';
    }

    lines.push(`• *${p.pocketName}*: ${formatRupiah(p.closingBalance)} [${p.rolloverMode}] ${note}`);
  }

  return lines.join('\n');
}

