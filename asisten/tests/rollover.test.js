import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../src/db/pool.js';
import { ensurePeriod, getMainBalance } from '../src/services/periods.js';
import {
  getPocketByName,
  getPocketBalance,
  setRolloverMode,
} from '../src/services/pockets.js';
import { addTransaction, setMonthlyIncome } from '../src/services/transactions.js';
import {
  closePeriod,
  ensurePreviousPeriodsClosed,
  formatRolloverSummary,
} from '../src/services/rollover.js';

describe('Fase 2 - Rollover & Penutupan Periode (Checkpoint D)', () => {
  let periodJan;
  let pocketKebutuhan;
  let pocketHiburan;
  let pocketDarurat;
  let pocketTabungan;

  beforeAll(async () => {
    // Gunakan tahun 2097 untuk isolasi pengujian rollover
    periodJan = await ensurePeriod(2097, 1);

    // Pastikan mode rollover kantong sesuai aturan:
    // Kebutuhan = carry, Hiburan = return, Darurat = carry
    await setRolloverMode('Kebutuhan', 'carry');
    await setRolloverMode('Hiburan', 'return');
    await setRolloverMode('Darurat', 'carry');
    await setRolloverMode('Tabungan', 'carry');

    pocketKebutuhan = await getPocketByName('Kebutuhan');
    pocketHiburan = await getPocketByName('Hiburan');
    pocketDarurat = await getPocketByName('Darurat');
    pocketTabungan = await getPocketByName('Tabungan');

    // Bersihkan data tahun 2097 jika ada
    await pool.query(
      `DELETE FROM pocket_transfers WHERE period_id IN (SELECT id FROM periods WHERE year = 2097)`
    );
    await pool.query(
      `DELETE FROM transactions WHERE period_id IN (SELECT id FROM periods WHERE year = 2097)`
    );
    await pool.query(
      `DELETE FROM period_pockets WHERE period_id IN (SELECT id FROM periods WHERE year = 2097)`
    );
    await pool.query(`DELETE FROM periods WHERE year = 2097 AND id != $1`, [periodJan.id]);

    // Reset status periodJan
    await pool.query("UPDATE periods SET status = 'open', main_opening = 0 WHERE id = $1", [
      periodJan.id,
    ]);

    // Setup alokasi periodJan:
    // Uang bulanan 2.000.000
    // Kebutuhan: alloc_amount = 1.000.000
    // Hiburan: alloc_amount = 500.000
    // Darurat: alloc_amount = 100.000
    // Tabungan: alloc_amount = 0
    // Total alokasi = 1.600.000
    // Sisa di Saldo Utama = 2.000.000 - 1.600.000 = 400.000 (Skenario d)
    await pool.query(
      `INSERT INTO period_pockets (period_id, pocket_id, alloc_percent, alloc_amount, rollover_in)
       VALUES
         ($1, $2, 50, 1000000, 0),
         ($1, $3, 25, 500000, 0),
         ($1, $4, 5, 100000, 0),
         ($1, $5, 0, 0, 0)`,
      [
        periodJan.id,
        pocketKebutuhan.id,
        pocketHiburan.id,
        pocketDarurat.id,
        pocketTabungan.id,
      ]
    );

    // Pemasukan uang bulanan 2.000.000 ke saldo utama
    await addTransaction({
      periodId: periodJan.id,
      type: 'masuk',
      amount: 2000000,
      isMonthlyIncome: true,
      txDate: '2097-01-01',
    });

    // (a) Kebutuhan (carry): belanja 800.000 -> sisa +200.000
    await addTransaction({
      periodId: periodJan.id,
      type: 'keluar',
      amount: 800000,
      pocketId: pocketKebutuhan.id,
      txDate: '2097-01-05',
    });

    // (b) Hiburan (return): belanja 200.000 -> sisa +300.000
    await addTransaction({
      periodId: periodJan.id,
      type: 'keluar',
      amount: 200000,
      pocketId: pocketHiburan.id,
      txDate: '2097-01-10',
    });

    // (c) Darurat (carry): belanja 150.000 (melebihi 100.000) -> sisa -50.000 (defisit)
    await addTransaction({
      periodId: periodJan.id,
      type: 'keluar',
      amount: 150000,
      pocketId: pocketDarurat.id,
      txDate: '2097-01-15',
    });
  });

  afterAll(async () => {
    await pool.query(
      `DELETE FROM pocket_transfers WHERE period_id IN (SELECT id FROM periods WHERE year = 2097)`
    );
    await pool.query(
      `DELETE FROM transactions WHERE period_id IN (SELECT id FROM periods WHERE year = 2097)`
    );
    await pool.query(
      `DELETE FROM period_pockets WHERE period_id IN (SELECT id FROM periods WHERE year = 2097)`
    );
    await pool.query(`DELETE FROM periods WHERE year = 2097`);
  });

  it('memverifikasi kondisi saldo sebelum tutup bulan', async () => {
    // Sisa saldo utama = 400.000
    const mainBal = await getMainBalance(periodJan.id);
    expect(mainBal).toBe(400000n);

    // Kebutuhan = 1.000.000 - 800.000 = +200.000
    const balKeb = await getPocketBalance(periodJan.id, pocketKebutuhan.id);
    expect(balKeb.balance).toBe(200000n);

    // Hiburan = 500.000 - 200.000 = +300.000
    const balHib = await getPocketBalance(periodJan.id, pocketHiburan.id);
    expect(balHib.balance).toBe(300000n);

    // Darurat = 100.000 - 150.000 = -50.000 (defisit)
    const balDar = await getPocketBalance(periodJan.id, pocketDarurat.id);
    expect(balDar.balance).toBe(-50000n);
  });

  it('menutup periode dan memverifikasi semua aturan rollover', async () => {
    const summary = await closePeriod(periodJan.id);

    expect(summary.alreadyClosed).toBe(false);
    expect(summary.periodId).toBe(periodJan.id);
    expect(summary.nextYear).toBe(2097);
    expect(summary.nextMonth).toBe(2);

    // Hitungan manual mainCarry untuk Februari 2097:
    // Sisa saldo utama (400.000)
    // + Sisa Hiburan mode return (+300.000)
    // + Defisit Darurat (-50.000)
    // = 650.000
    expect(summary.mainCarry).toBe(650000n);

    // Verifikasi di database pada periode Februari 2097:
    const pFebRes = await pool.query(
      'SELECT * FROM periods WHERE year = 2097 AND month = 2'
    );
    expect(pFebRes.rows.length).toBe(1);
    const periodFeb = pFebRes.rows[0];
    expect(BigInt(periodFeb.main_opening)).toBe(650000n);

    // (a) Kebutuhan (carry): rollover_in harus 200.000
    const febKeb = await getPocketBalance(periodFeb.id, pocketKebutuhan.id);
    expect(febKeb.rolloverIn).toBe(200000n);
    expect(febKeb.balance).toBe(200000n);

    // (b) Hiburan (return): rollover_in harus 0 (sudah kembali ke saldo utama)
    const febHib = await getPocketBalance(periodFeb.id, pocketHiburan.id);
    expect(febHib.rolloverIn).toBe(0n);
    expect(febHib.balance).toBe(0n);

    // (c) Darurat (defisit): rollover_in harus 0 (defisit membebani main_opening, reset ke 0)
    const febDar = await getPocketBalance(periodFeb.id, pocketDarurat.id);
    expect(febDar.rolloverIn).toBe(0n);
    expect(febDar.balance).toBe(0n);

    // (d) Saldo Utama Februari awal = main_opening = 650.000
    const mainBalFeb = await getMainBalance(periodFeb.id);
    expect(mainBalFeb).toBe(650000n);

    // Format teks ringkasan untuk WhatsApp
    const msg = formatRolloverSummary(summary);
    expect(msg).toContain('Tutup Buku & Rollover: 1/2097');
    expect(msg).toContain('Rp 650.000');
  });

  it('(e) pemanggilan closePeriod kedua kali bersifat idempoten (hasil identik)', async () => {
    const summary2 = await closePeriod(periodJan.id);
    expect(summary2.alreadyClosed).toBe(true);

    // Pastikan main_opening Februari tidak berubah / tidak bertambah ganda
    const pFebRes = await pool.query(
      'SELECT main_opening FROM periods WHERE year = 2097 AND month = 2'
    );
    expect(BigInt(pFebRes.rows[0].main_opening)).toBe(650000n);
  });

  it('(f) penutupan bulan tanpa transaksi berjalan bersih dengan saldo 0', async () => {
    // Buat bulan kosong (Mei 2097)
    const periodMay = await ensurePeriod(2097, 5);

    const summaryMay = await closePeriod(periodMay.id);
    expect(summaryMay.alreadyClosed).toBe(false);
    expect(summaryMay.mainCarry).toBe(0n);

    // Periode Juni 2097 harus memiliki main_opening = 0
    const pJunRes = await pool.query(
      'SELECT main_opening FROM periods WHERE year = 2097 AND month = 6'
    );
    expect(BigInt(pJunRes.rows[0].main_opening)).toBe(0n);
  });

  it('lazy closure: memastikan periode terbuka masa lalu tertutup otomatis', async () => {
    // Buat periode terbuka bulan 3 dan 4 tahun 2097
    const p3 = await ensurePeriod(2097, 3);
    const p4 = await ensurePeriod(2097, 4);

    expect(p3.status).toBe('open');
    expect(p4.status).toBe('open');

    // Asumsikan saat ini bulan 5 tahun 2097 -> bulan 3 dan 4 harus ditutup otomatis
    const closedList = await ensurePreviousPeriodsClosed(2097, 5);
    expect(closedList.length).toBeGreaterThanOrEqual(2);

    const checkP3 = await pool.query('SELECT status FROM periods WHERE id = $1', [p3.id]);
    const checkP4 = await pool.query('SELECT status FROM periods WHERE id = $1', [p4.id]);
    expect(checkP3.rows[0].status).toBe('closed');
    expect(checkP4.rows[0].status).toBe('closed');
  });
});

