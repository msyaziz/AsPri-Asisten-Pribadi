import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { pool } from '../src/db/pool.js';
import { ensurePeriod, getTotalMoney, getMainBalance } from '../src/services/periods.js';
import { getPocketByName, setAllocations } from '../src/services/pockets.js';
import { addTransaction, setMonthlyIncome } from '../src/services/transactions.js';
import {
  getSpendingReport,
  getIncomeReport,
  listTransactionsReport,
  getMonthlyFinancialReport,
} from '../src/services/reports.js';
import { respondToDataQuery, formatFallbackResponse } from '../src/ai/respond.js';
import { executeTool } from '../src/tools/index.js';
import { understandMessage } from '../src/ai/understand.js';
import { processSingleMessage } from '../src/bot/router.js';
import * as senderModule from '../src/bot/sender.js';
import { extractRupiah } from '../src/utils/rupiah.js';

describe('Fase 3 - Tool Baca, Reports & Respond Agent (Checkpoint C)', () => {
  let testPeriod;
  const WHITELIST_JID = '6285642060441@s.whatsapp.net';
  let sentReplies = [];

  async function simulateUserMessage(text) {
    const repliesBefore = sentReplies.length;
    const msgId = `msg_user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const msg = {
      key: {
        remoteJid: WHITELIST_JID,
        fromMe: false,
        id: msgId,
      },
      message: {
        conversation: text,
      },
    };

    await processSingleMessage(msg);
    const newReplies = sentReplies.slice(repliesBefore);
    return newReplies[newReplies.length - 1] || null;
  }

  beforeAll(async () => {
    // Isolasi periode testing (Maret 2095)
    testPeriod = await ensurePeriod(2095, 3);

    // Mock sendText
    vi.spyOn(senderModule, 'sendText').mockImplementation(async (_jid, text) => {
      const botMsgId = `bot_reply_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      sentReplies.push({ text, botMsgId });
      return [botMsgId];
    });

    // Bersihkan data lama pada periode testing
    await pool.query('DELETE FROM pending_actions');
    await pool.query('DELETE FROM action_log');
    await pool.query('DELETE FROM pocket_transfers WHERE period_id = $1', [testPeriod.id]);
    await pool.query('DELETE FROM transactions WHERE period_id = $1', [testPeriod.id]);
    await pool.query('DELETE FROM period_pockets WHERE period_id = $1', [testPeriod.id]);

    // Setup uang bulanan 3 juta
    await setMonthlyIncome({
      periodId: testPeriod.id,
      amount: 3000000,
      mode: 'tambah',
    });

    // Setup alokasi: 50% Kebutuhan (1.500.000), 30% Hiburan (900.000), 20% Tabungan (600.000)
    await setAllocations(testPeriod.id, [
      { pocketName: 'Kebutuhan', percent: 50 },
      { pocketName: 'Hiburan', percent: 30 },
      { pocketName: 'Tabungan', percent: 20 },
    ]);

    // Tambah pengeluaran di Kebutuhan: 50.000 (makan)
    const pKebutuhan = await getPocketByName('Kebutuhan');
    const catMakanan = (await pool.query("SELECT id FROM categories WHERE name = 'Makanan'")).rows[0];

    await addTransaction({
      periodId: testPeriod.id,
      type: 'keluar',
      amount: 50000,
      categoryId: catMakanan?.id || null,
      pocketId: pKebutuhan.id,
      note: 'makan siang',
      txDate: '2095-03-10',
    });

    // Tambah pengeluaran di Hiburan: 25.000 (nonton)
    const pHiburan = await getPocketByName('Hiburan');
    const catHiburan = (await pool.query("SELECT id FROM categories WHERE name = 'Hiburan'")).rows[0];

    await addTransaction({
      periodId: testPeriod.id,
      type: 'keluar',
      amount: 25000,
      categoryId: catHiburan?.id || null,
      pocketId: pHiburan.id,
      note: 'nonton film',
      txDate: '2095-03-11',
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
  });

  describe('1. Services Reports (Tool Baca)', () => {
    it('getSpendingReport menghitung total dan rincian pengeluaran per kategori', async () => {
      const report = await getSpendingReport({
        dateFrom: '2095-03-01',
        dateTo: '2095-03-31',
      });

      expect(report.totalSpending).toBe(75000);
      expect(report.byCategory.length).toBeGreaterThanOrEqual(2);

      const makanCat = report.byCategory.find((c) => c.category === 'Makanan');
      expect(makanCat).toBeDefined();
      expect(makanCat.total).toBe(50000);

      const hiburanCat = report.byCategory.find((c) => c.category === 'Hiburan');
      expect(hiburanCat).toBeDefined();
      expect(hiburanCat.total).toBe(25000);
    });

    it('getSpendingReport dapat memfilter berdasarkan kategori tertentu', async () => {
      const report = await getSpendingReport({
        dateFrom: '2095-03-01',
        dateTo: '2095-03-31',
        category: 'Makanan',
      });

      expect(report.totalSpending).toBe(50000);
      expect(report.byCategory.length).toBe(1);
      expect(report.byCategory[0].category).toBe('Makanan');
    });

    it('listTransactionsReport menyajikan daftar transaksi dengan informasi lengkap', async () => {
      const report = await listTransactionsReport({
        dateFrom: '2095-03-01',
        dateTo: '2095-03-31',
        type: 'keluar',
        limit: 10,
      });

      expect(report.count).toBe(2);
      expect(report.transactions[0].amount).toBeDefined();
      expect(report.transactions[0].category).toBeDefined();
    });

    it('getMonthlyFinancialReport menyajikan ringkasan bulanan menyeluruh', async () => {
      const report = await getMonthlyFinancialReport({
        year: 2095,
        month: 3,
      });

      expect(report.income).toBe(3000000);
      expect(report.spending).toBe(75000);
      expect(report.grandTotal).toBe(2925000);
    });
  });

  describe('2. Respond Agent & Fallback', () => {
    it('formatFallbackResponse menghasilkan teks akurat dari objek data tanpa AI', () => {
      const sampleData = {
        grandTotal: 2925000,
        mainBalance: 0,
        pocketsTotal: 2925000,
      };

      const fallbackText = formatFallbackResponse(sampleData);
      expect(fallbackText).toContain('Rp 2.925.000');
    });

    it('respondToDataQuery merangkai teks berdasarkan data query', async () => {
      const sampleData = {
        totalSpending: 75000,
        period: 'bulan ini',
        byCategory: [
          { category: 'Makanan', total: 50000, count: 1 },
          { category: 'Hiburan', total: 25000, count: 1 },
        ],
      };

      const answer = await respondToDataQuery({
        question: 'Pengeluaran bulan ini berapa?',
        data: sampleData,
      });

      expect(typeof answer).toBe('string');
      // Jawaban harus memuat angka 75.000 atau format rupiahnya
      const amounts = extractRupiah(answer);
      expect(amounts).toContain(75000);
    });
  });

  describe('3. Checkpoint C: "total uang saya berapa?" Sama Persis dengan View Saldo', () => {
    it('"total uang saya berapa?" mengembalikan angka yang sama persis dengan view v_main_balance dan v_pocket_balance', async () => {
      // 1. Ambil data saldo aktual langsung dari view database
      const totalMoneyDb = await getTotalMoney(testPeriod.id);
      const expectedGrandTotal = Number(totalMoneyDb.grandTotal);
      expect(expectedGrandTotal).toBe(2925000);

      // 2. Simulasikan pemahaman intent "total uang saya berapa?"
      const understood = await understandMessage('total uang saya berapa?');
      expect(understood.intent).toBe('tanya_data');
      expect(understood.actions.length).toBe(1);
      expect(understood.actions[0].tool).toBe('get_total_money');

      // 3. Eksekusi tool get_total_money
      const execResult = await executeTool(understood.actions[0], {
        messageText: 'total uang saya berapa?',
        confidence: understood.confidence,
        periodId: testPeriod.id,
      });

      expect(execResult.status).toBe('executed');
      expect(execResult.data.grandTotal).toBe(expectedGrandTotal);

      // 4. VERIFIKASI UTAMA CHECKPOINT C:
      // Angka nominal pada teks balasan bot harus memuat expectedGrandTotal yang sama persis dengan view database!
      const extractedNominals = extractRupiah(execResult.reply);
      expect(extractedNominals).toContain(expectedGrandTotal);
    });
  });
});
