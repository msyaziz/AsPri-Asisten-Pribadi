import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../src/db/pool.js';
import { ensurePeriod, getMainBalance, getTotalMoney } from '../src/services/periods.js';
import {
  getActivePockets,
  getPocketByName,
  getPocketBalances,
  getPocketBalance,
  setAllocations,
} from '../src/services/pockets.js';
import {
  addTransaction,
  setMonthlyIncome,
  deleteTransaction,
} from '../src/services/transactions.js';
import { transferBetweenPockets } from '../src/services/transfers.js';

describe('Fase 2 - Services Keuangan & Formula Saldo (Checkpoint C)', () => {
  let testPeriod;
  let pocketKebutuhan;
  let pocketTabungan;
  let pocketHiburan;

  beforeAll(async () => {
    // Gunakan periode isolasi khusus testing (Januari 2099)
    testPeriod = await ensurePeriod(2099, 1);

    // Bersihkan data lama jika ada
    await pool.query('DELETE FROM pocket_transfers WHERE period_id = $1', [testPeriod.id]);
    await pool.query('DELETE FROM transactions WHERE period_id = $1', [testPeriod.id]);
    await pool.query('DELETE FROM period_pockets WHERE period_id = $1', [testPeriod.id]);

    // Re-inisialisasi kantong untuk testPeriod
    const pockets = await getActivePockets();
    for (const p of pockets) {
      await pool.query(
        `INSERT INTO period_pockets (period_id, pocket_id, alloc_percent, alloc_amount, rollover_in)
         VALUES ($1, $2, 0, 0, 0)`,
        [testPeriod.id, p.id]
      );
    }

    pocketKebutuhan = await getPocketByName('Kebutuhan');
    pocketTabungan = await getPocketByName('Tabungan');
    pocketHiburan = await getPocketByName('Hiburan');
  });

  afterAll(async () => {
    // Bersihkan data testing
    if (testPeriod) {
      await pool.query('DELETE FROM pocket_transfers WHERE period_id = $1', [testPeriod.id]);
      await pool.query('DELETE FROM transactions WHERE period_id = $1', [testPeriod.id]);
      await pool.query('DELETE FROM period_pockets WHERE period_id = $1', [testPeriod.id]);
      await pool.query('DELETE FROM periods WHERE id = $1', [testPeriod.id]);
    }
  });

  it('menolak alokasi jika total persentase > 100%', async () => {
    await expect(
      setAllocations(testPeriod.id, [
        { pocketId: pocketKebutuhan.id, percent: 60 },
        { pocketId: pocketHiburan.id, percent: 50 },
      ])
    ).rejects.toThrow(/melebihi 100%/);
  });

  it('menerapkan alokasi valid (50% Kebutuhan, 20% Tabungan, 30% Hiburan = 100%)', async () => {
    const res = await setAllocations(testPeriod.id, [
      { pocketId: pocketKebutuhan.id, percent: 50 },
      { pocketId: pocketTabungan.id, percent: 20 },
      { pocketId: pocketHiburan.id, percent: 30 },
    ]);
    expect(res.totalPercent).toBe(100);
  });

  it('mencatat uang bulanan 3 juta dan membagi ke kantong secara otomatis', async () => {
    const res = await setMonthlyIncome({
      periodId: testPeriod.id,
      amount: 3000000,
      mode: 'tambah',
      txDate: '2099-01-01',
    });

    expect(res.transaction).toBeDefined();
    expect(res.transaction.amount).toBe(3000000n);

    // Kebutuhan 50% = 1.500.000
    const balKeb = await getPocketBalance(testPeriod.id, pocketKebutuhan.id);
    expect(balKeb.allocAmount).toBe(1500000n);
    expect(balKeb.balance).toBe(1500000n);

    // Tabungan 20% = 600.000
    const balTab = await getPocketBalance(testPeriod.id, pocketTabungan.id);
    expect(balTab.allocAmount).toBe(600000n);
    expect(balTab.balance).toBe(600000n);

    // Hiburan 30% = 900.000
    const balHib = await getPocketBalance(testPeriod.id, pocketHiburan.id);
    expect(balHib.allocAmount).toBe(900000n);
    expect(balHib.balance).toBe(900000n);

    // Saldo Utama = 3.000.000 - (1.500.000 + 600.000 + 900.000) = 0
    const mainBal = await getMainBalance(testPeriod.id);
    expect(mainBal).toBe(0n);

    // Total uang = 3.000.000
    const total = await getTotalMoney(testPeriod.id);
    expect(total.grandTotal).toBe(3000000n);
  });

  it('menangani sisa pembulatan alokasi yang tetap berada di saldo utama', async () => {
    // Buat periode kedua untuk menguji pembulatan desimal (Februari 2099)
    const p2 = await ensurePeriod(2099, 2);
    try {
      // 33.33% ke Kebutuhan, nolkan kantong lain
      await setAllocations(p2.id, [
        { pocketId: pocketKebutuhan.id, percent: 33.33 },
        { pocketId: pocketTabungan.id, percent: 0 },
        { pocketId: pocketHiburan.id, percent: 0 },
      ]);
      await setMonthlyIncome({
        periodId: p2.id,
        amount: 1000000,
        txDate: '2099-02-01',
      });

      // 33.33% dari 1.000.000 = 333.300
      const balKeb = await getPocketBalance(p2.id, pocketKebutuhan.id);
      expect(balKeb.allocAmount).toBe(333300n);

      // Sisa 666.700 tetap di Saldo Utama
      const mainBal = await getMainBalance(p2.id);
      expect(mainBal).toBe(666700n);

      const total = await getTotalMoney(p2.id);
      expect(total.grandTotal).toBe(1000000n);
    } finally {
      await pool.query('DELETE FROM transactions WHERE period_id = $1', [p2.id]);
      await pool.query('DELETE FROM period_pockets WHERE period_id = $1', [p2.id]);
      await pool.query('DELETE FROM periods WHERE id = $1', [p2.id]);
    }
  });

  it('mencatat pengeluaran kantong (kopi 18rb di Hiburan) dan memverifikasi saldo', async () => {
    const tx = await addTransaction({
      periodId: testPeriod.id,
      type: 'keluar',
      amount: 18000,
      pocketId: pocketHiburan.id,
      note: 'kopi',
      txDate: '2099-01-02',
    });

    expect(tx.id).toBeDefined();

    // Saldo Hiburan: 900.000 - 18.000 = 882.000
    const balHib = await getPocketBalance(testPeriod.id, pocketHiburan.id);
    expect(balHib.spent).toBe(18000n);
    expect(balHib.balance).toBe(882000n);

    // Saldo Utama tetap 0
    expect(await getMainBalance(testPeriod.id)).toBe(0n);
  });

  it('mencatat pengeluaran tanpa kantong (memotong Saldo Utama)', async () => {
    await addTransaction({
      periodId: testPeriod.id,
      type: 'keluar',
      amount: 50000,
      pocketId: null, // Tanpa kantong = saldo utama
      note: 'pengeluaran lain',
      txDate: '2099-01-03',
    });

    // Saldo Utama: 0 - 50.000 = -50.000
    const mainBal = await getMainBalance(testPeriod.id);
    expect(mainBal).toBe(-50000n);
  });

  it('menolak transfer jika saldo sumber tidak mencukupi', async () => {
    await expect(
      transferBetweenPockets({
        periodId: testPeriod.id,
        fromPocketId: pocketHiburan.id,
        toPocketId: pocketKebutuhan.id,
        amount: 99000000, // 99 juta > saldo hiburan (882rb)
      })
    ).rejects.toThrow(/tidak mencukupi/);
  });

  it('melakukan transfer 100rb dari Hiburan ke Kebutuhan', async () => {
    const res = await transferBetweenPockets({
      periodId: testPeriod.id,
      fromPocketId: pocketHiburan.id,
      toPocketId: pocketKebutuhan.id,
      amount: 100000,
      note: 'pindah dana',
    });

    expect(res.fromBalanceAfter).toBe(782000n); // 882.000 - 100.000
    expect(res.toBalanceAfter).toBe(1600000n); // 1.500.000 + 100.000

    const balHib = await getPocketBalance(testPeriod.id, pocketHiburan.id);
    expect(balHib.transferOut).toBe(100000n);
    expect(balHib.balance).toBe(782000n);

    const balKeb = await getPocketBalance(testPeriod.id, pocketKebutuhan.id);
    expect(balKeb.transferIn).toBe(100000n);
    expect(balKeb.balance).toBe(1600000n);
  });

  it('melakukan transfer 200rb dari Kebutuhan ke Saldo Utama (toPocketId = null)', async () => {
    const res = await transferBetweenPockets({
      periodId: testPeriod.id,
      fromPocketId: pocketKebutuhan.id,
      toPocketId: null, // Saldo utama
      amount: 200000,
    });

    expect(res.fromBalanceAfter).toBe(1400000n); // 1.600.000 - 200.000
    expect(res.toBalanceAfter).toBe(150000n); // -50.000 + 200.000

    const mainBal = await getMainBalance(testPeriod.id);
    expect(mainBal).toBe(150000n);
  });

  it('menguji soft-delete transaksi (membatalkan pengeluaran kopi 18rb)', async () => {
    // Ambil transaksi kopi
    const txRes = await pool.query(
      "SELECT id FROM transactions WHERE period_id = $1 AND note = 'kopi' AND deleted_at IS NULL",
      [testPeriod.id]
    );
    const kopiTxId = txRes.rows[0].id;

    // Hapus transaksi
    await deleteTransaction(kopiTxId);

    // Saldo Hiburan pulih: 782.000 + 18.000 = 800.000
    const balHib = await getPocketBalance(testPeriod.id, pocketHiburan.id);
    expect(balHib.spent).toBe(0n);
    expect(balHib.balance).toBe(800000n);

    // Verifikasi Grand Total:
    // Saldo Utama (150.000) + Kebutuhan (1.400.000) + Tabungan (600.000) + Hiburan (800.000)
    // = 2.950.000 (Original 3.000.000 - pengeluaran tanpa kantong 50.000 = 2.950.000)
    const total = await getTotalMoney(testPeriod.id);
    expect(total.grandTotal).toBe(2950000n);
    expect(total.mainBalance).toBe(150000n);
    expect(total.pocketTotal).toBe(2800000n);
  });
});
