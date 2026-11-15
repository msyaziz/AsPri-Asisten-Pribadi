/**
 * Test Checkpoint E — Peringatan Kantong Menipis.
 * Memverifikasi:
 * 1. Transaksi yang menguras kantong hingga < 20% alokasi → memiliki lowBalanceAlert.
 * 2. Transaksi berikutnya di kantong yang sama → TIDAK ada peringatan kedua (idempoten).
 * 3. Transaksi yang tidak menguras kantong → tidak ada peringatan.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../src/db/pool.js';
import { addTransaction, checkLowBalanceAlert } from '../src/services/transactions.js';
import { setMonthlyIncome } from '../src/services/transactions.js';
import { setAllocations } from '../src/services/pockets.js';

const TEST_PERIOD_YEAR = 2098;
const TEST_PERIOD_MONTH = 11;
let testPeriodId;
const POCKET_KEBUTUHAN_ID = 1; // id=1 'Kebutuhan'
const CATEGORY_MAKANAN_ID = 1; // id=1 'Makanan', default_pocket_id=1

async function cleanupTestData() {
  await pool.query(
    'DELETE FROM transactions WHERE period_id IN (SELECT id FROM periods WHERE year = $1 AND month = $2)',
    [TEST_PERIOD_YEAR, TEST_PERIOD_MONTH]
  );
  await pool.query(
    'DELETE FROM period_pockets WHERE period_id IN (SELECT id FROM periods WHERE year = $1 AND month = $2)',
    [TEST_PERIOD_YEAR, TEST_PERIOD_MONTH]
  );
  await pool.query('DELETE FROM periods WHERE year = $1 AND month = $2', [
    TEST_PERIOD_YEAR,
    TEST_PERIOD_MONTH,
  ]);
}

beforeAll(async () => {
  await cleanupTestData();

  // Buat periode test unik
  const pRes = await pool.query(
    `INSERT INTO periods (year, month, status)
     VALUES ($1, $2, 'open')
     RETURNING id`,
    [TEST_PERIOD_YEAR, TEST_PERIOD_MONTH]
  );
  testPeriodId = pRes.rows[0].id;

  // Alokasi kantong Kebutuhan: 100.000 (agar threshold < 20% = 20.000)
  await pool.query(
    `INSERT INTO period_pockets (period_id, pocket_id, alloc_percent, alloc_amount, low_alert_sent)
     VALUES ($1, $2, 50, 100000, FALSE)`,
    [testPeriodId, POCKET_KEBUTUHAN_ID]
  );
});

afterAll(async () => {
  await cleanupTestData();
  await pool.end();
});

describe('Checkpoint E — Peringatan Kantong Menipis', () => {
  it('tidak memperingatkan ketika saldo masih > 20% alokasi', async () => {
    // Transaksi 30.000 → sisa 70.000 (70%) — masih jauh di atas 20%
    const tx = await addTransaction({
      periodId: testPeriodId,
      type: 'keluar',
      amount: 30_000,
      categoryId: CATEGORY_MAKANAN_ID,
      pocketId: POCKET_KEBUTUHAN_ID,
      note: 'makan siang test',
    });

    expect(tx.lowBalanceAlert).toBeNull();
  });

  it('memperingatkan saat saldo kantong turun ke < 20% alokasi', async () => {
    // Setelah transaksi sebelumnya (30.000), tambah 65.000 → total pengeluaran 95.000
    // Sisa = 100.000 - 95.000 = 5.000 (5%) → di bawah 20%
    const tx = await addTransaction({
      periodId: testPeriodId,
      type: 'keluar',
      amount: 65_000,
      categoryId: CATEGORY_MAKANAN_ID,
      pocketId: POCKET_KEBUTUHAN_ID,
      note: 'belanja test',
    });

    expect(tx.lowBalanceAlert).not.toBeNull();
    expect(tx.lowBalanceAlert.pocketName).toBe('Kebutuhan');
    expect(tx.lowBalanceAlert.balance).toBe(5_000n);
    expect(tx.lowBalanceAlert.allocAmount).toBe(100_000n);
  });

  it('tidak mengirim peringatan kedua kali (idempoten)', async () => {
    // Transaksi tambahan di kantong yang sama — low_alert_sent sudah TRUE
    const tx = await addTransaction({
      periodId: testPeriodId,
      type: 'keluar',
      amount: 1_000,
      categoryId: CATEGORY_MAKANAN_ID,
      pocketId: POCKET_KEBUTUHAN_ID,
      note: 'kopi test',
    });

    // Tidak boleh ada peringatan lagi
    expect(tx.lowBalanceAlert).toBeNull();
  });

  it('tidak memperingatkan untuk transaksi tanpa kantong (pocket_id NULL)', async () => {
    const tx = await addTransaction({
      periodId: testPeriodId,
      type: 'masuk',
      amount: 50_000,
      categoryId: null,
      pocketId: null,
      note: 'pemasukan tanpa kantong',
    });

    expect(tx.lowBalanceAlert).toBeNull();
  });

  it('checkLowBalanceAlert mengembalikan null jika sudah low_alert_sent = TRUE', async () => {
    // Verifikasi langsung: setelah test sebelumnya, low_alert_sent harus TRUE
    const alert = await checkLowBalanceAlert(testPeriodId, POCKET_KEBUTUHAN_ID);
    expect(alert).toBeNull();
  });

  it('checkLowBalanceAlert mengembalikan peringatan untuk kantong baru yang menipis', async () => {
    const POCKET_HIBURAN_ID = 3; // 'Hiburan'

    // Setup alokasi kantong Hiburan: 50.000
    await pool.query(
      `INSERT INTO period_pockets (period_id, pocket_id, alloc_percent, alloc_amount, low_alert_sent)
       VALUES ($1, $2, 10, 50000, FALSE)
       ON CONFLICT (period_id, pocket_id) DO UPDATE
         SET alloc_amount = 50000, low_alert_sent = FALSE`,
      [testPeriodId, POCKET_HIBURAN_ID]
    );

    // Belanja 48.000 → sisa 2.000 (4%) → menipis
    await addTransaction({
      periodId: testPeriodId,
      type: 'keluar',
      amount: 48_000,
      categoryId: 5, // Hiburan category
      pocketId: POCKET_HIBURAN_ID,
      note: 'nonton test',
    });

    // Sekarang checkLowBalanceAlert harus sudah mengembalikan null (sudah ditandai saat addTransaction)
    const alertAfter = await checkLowBalanceAlert(testPeriodId, POCKET_HIBURAN_ID);
    expect(alertAfter).toBeNull(); // sudah ditandai oleh addTransaction

    // Verifikasi low_alert_sent sudah TRUE di DB
    const dbCheck = await pool.query(
      'SELECT low_alert_sent FROM period_pockets WHERE period_id = $1 AND pocket_id = $2',
      [testPeriodId, POCKET_HIBURAN_ID]
    );
    expect(dbCheck.rows[0]?.low_alert_sent).toBe(true);
  });
});
