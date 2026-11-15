import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { pool } from '../src/db/pool.js';
import {
  getCategories,
  getCategoryByName,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
  findCategoryByRule,
  upsertCategoryRule,
  learnFromCorrection,
  getCategoryRules,
} from '../src/services/categories.js';
import { understandMessage } from '../src/ai/understand.js';
import * as groqModule from '../src/ai/groq.js';
import * as senderModule from '../src/bot/sender.js';
import { executeTool } from '../src/tools/index.js';
import { processSingleMessage } from '../src/bot/router.js';
import { getActivePendingAction, resolvePendingAction } from '../src/services/pendingActions.js';
import { ensurePeriod } from '../src/services/periods.js';
import { addTransaction } from '../src/services/transactions.js';
import { handleRegexCommand } from '../src/bot/regexCommands.js';

describe('Fase 3 - Kategori, Category Rules & Lapis 3 (Checkpoint A & B)', () => {
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
    // Gunakan periode isolasi khusus testing (Januari 2095)
    testPeriod = await ensurePeriod(2095, 1);

    vi.spyOn(senderModule, 'sendText').mockImplementation(async (_jid, text) => {
      const botMsgId = `bot_reply_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      sentReplies.push({ text, botMsgId });
      return [botMsgId];
    });
  });

  afterAll(async () => {
    // Bersihkan rule testing jika ada
    await pool.query("DELETE FROM category_rules WHERE source = 'koreksi' OR keyword LIKE 'test_%'");
    await pool.query("DELETE FROM categories WHERE name LIKE 'Test_%'");
  });

  describe('1. CRUD Kategori', () => {
    it('getCategories mengambil daftar kategori aktif', async () => {
      const cats = await getCategories({ activeOnly: true });
      expect(cats.length).toBeGreaterThan(0);
      const food = cats.find((c) => c.name.toLowerCase() === 'makanan');
      expect(food).toBeDefined();
      expect(food.is_active).toBe(true);
    });

    it('getCategoryByName mencari kategori secara case-insensitive', async () => {
      const cat = await getCategoryByName('mAkaNan');
      expect(cat).toBeDefined();
      expect(cat.name).toBe('Makanan');
    });

    it('createCategory membuat kategori baru dan deleteCategory menonaktifkannya', async () => {
      const testCatName = `Test_Hobi_${Date.now()}`;
      const created = await createCategory({ name: testCatName, type: 'keluar' });
      expect(created.id).toBeDefined();
      expect(created.name).toBe(testCatName);
      expect(created.is_active).toBe(true);

      const fetched = await getCategoryById(created.id);
      expect(fetched.name).toBe(testCatName);

      // Soft delete
      await deleteCategory(created.id);
      const afterDelete = await getCategoryById(created.id);
      expect(afterDelete.is_active).toBe(false);

      // Tidak muncul di getCategories activeOnly: true
      const activeCats = await getCategories({ activeOnly: true });
      expect(activeCats.some((c) => c.id === created.id)).toBe(false);
    });
  });

  describe('2. Pencocokan & Pembelajaran Aturan Kategori (category_rules)', () => {
    it('findCategoryByRule mencocokkan kata kunci seed (misal: "kopi" -> Hiburan)', async () => {
      const match = await findCategoryByRule('beli kopi susu enak');
      expect(match).not.toBeNull();
      expect(match.keyword).toBe('kopi');
      expect(match.categoryName).toBe('Hiburan');
    });

    it('upsertCategoryRule menambah aturan baru dan menaikkan hits jika duplikat', async () => {
      const catMakanan = await getCategoryByName('Makanan');
      const testKw = `test_kw_${Date.now()}`;

      const rule1 = await upsertCategoryRule({
        keyword: testKw,
        categoryId: catMakanan.id,
        source: 'koreksi',
      });
      expect(rule1.hits).toBe(1);
      expect(rule1.source).toBe('koreksi');

      // Panggil lagi untuk keyword yang sama
      const rule2 = await upsertCategoryRule({
        keyword: testKw,
        categoryId: catMakanan.id,
        source: 'koreksi',
      });
      expect(rule2.hits).toBe(2);
    });

    it('learnFromCorrection mengekstrak kata kunci bermakna dari catatan transaksi', async () => {
      const catHiburan = await getCategoryByName('Hiburan');
      const note = 'beli tiket bioskop seru';

      const learned = await learnFromCorrection({
        text: note,
        categoryId: catHiburan.id,
      });

      expect(learned.length).toBeGreaterThan(0);
      const keywords = learned.map((r) => r.keyword);
      // 'tiket' atau 'bioskop' harus dipelajari
      expect(keywords.some((kw) => kw === 'tiket' || kw === 'bioskop')).toBe(true);

      // Verifikasi findCategoryByRule sekarang mengenali 'bioskop'
      const match = await findCategoryByRule('nonton bioskop yuk');
      expect(match).not.toBeNull();
      expect(match.categoryName).toBe('Hiburan');
    });
  });

  describe('3. Checkpoint A: Koreksi Kategori Membentuk Rule & Transaksi Berikutnya Tanpa Panggil AI', () => {
    it('koreksi kategori membentuk rule dan transaksi berikutnya dengan kata yang sama tidak memanggil AI', async () => {
      const uniqueWord = `siomay${Date.now() % 100000}`;
      const catMakanan = await getCategoryByName('Makanan');

      // 1. Buat transaksi awal dengan catatan mengandung kata unik (misal "siomay12345")
      const tx = await addTransaction({
        periodId: testPeriod.id,
        type: 'keluar',
        amount: 15000,
        categoryId: null, // kategori belum terisi
        pocketId: null,
        note: `makan ${uniqueWord}`,
      });
      expect(tx.id).toBeDefined();

      // 2. Pengguna mengirim koreksi via regex "ubah kategori jadi Makanan"
      const reply = await handleRegexCommand('ubah kategori jadi Makanan');
      expect(reply).toContain('berhasil diubah menjadi *Makanan*');

      // 3. Verifikasi bahwa rule baru untuk uniqueWord terbentuk di category_rules
      const ruleMatch = await findCategoryByRule(`beli ${uniqueWord} pedas`);
      expect(ruleMatch).not.null;
      expect(ruleMatch.keyword).toBe(uniqueWord);
      expect(ruleMatch.categoryName).toBe('Makanan');
      expect(ruleMatch.source).toBe('koreksi');

      // 4. Pengguna mengirim transaksi berikutnya dengan kata yang sama: "${uniqueWord} 20rb"
      // Pasang spy pada groqModule.chatCompletion untuk memastikan AI TIDAK dipanggil!
      const chatSpy = vi.spyOn(groqModule, 'chatCompletion');

      const understood = await understandMessage(`${uniqueWord} 20rb`);

      // Verifikasi pemahaman Lapis 1 berhasil dengan tepat
      expect(understood.intent).toBe('catat_transaksi');
      expect(understood.confidence).toBe(1.0);
      expect(understood.actions.length).toBe(1);
      expect(understood.actions[0].tool).toBe('add_transaction');
      expect(understood.actions[0].args.amount).toBe(20000);
      expect(understood.actions[0].args.category).toBe('Makanan');

      // VERIFIKASI UTAMA CHECKPOINT A: Groq API TIDAK DIPANGGIL SAMA SEKALI
      expect(chatSpy).not.toHaveBeenCalled();

      chatSpy.mockRestore();
    });
  });

  describe('4. Checkpoint B: Lapis 3 (Tanya Pengguna) via pending_actions tipe pilih_kategori', () => {
    it('executeTool add_transaction dengan confidence < 0.6 menghasilkan pending_action tipe pilih_kategori', async () => {
      // Pastikan tidak ada pending action aktif sebelumnya
      await pool.query('DELETE FROM pending_actions');

      const action = {
        tool: 'add_transaction',
        args: {
          type: 'keluar',
          amount: 35000,
          category: null,
          pocket: null,
          note: 'martabak manis keju',
          date: null,
        },
      };

      // Panggil executeTool dengan confidence 0.5 (< 0.6)
      const res = await executeTool(action, {
        messageText: 'martabak manis keju 35rb',
        confidence: 0.5,
      });

      expect(res.status).toBe('pending');
      expect(res.reply).toContain('Pilih Kategori');
      expect(res.reply).toContain('1. Makanan');
      expect(res.data).toBeDefined();
      expect(res.data.type).toBe('pilih_kategori');

      // Verifikasi di database pending_actions
      const active = await getActivePendingAction();
      expect(active).not.toBeNull();
      expect(active.type).toBe('pilih_kategori');
      expect(active.status).toBe('waiting');
    });

    it('balasan angka tidak valid ditolak dan pending action tetap aktif', async () => {
      // Kirim nomor 99
      const reply = await simulateUserMessage('99');
      expect(reply).not.toBeNull();
      expect(reply.text).toContain('Pilihan tidak valid');
      expect(reply.text).toContain('Silakan balas dengan nomor 1 -');

      // Pending action masih aktif
      const active = await getActivePendingAction();
      expect(active).not.toBeNull();
      expect(active.status).toBe('waiting');
    });

    it('balasan angka memilih kategori, mengeksekusi transaksi, dan mempelajari rule', async () => {
      const active = await getActivePendingAction();
      expect(active).not.toBeNull();

      // Pilih nomor 1 (Makanan)
      const reply = await simulateUserMessage('1');
      expect(reply).not.toBeNull();
      expect(reply.text).toContain('Pengeluaran Berhasil Dicatat');
      expect(reply.text).toContain('Rp 35.000');

      // Verifikasi pending action berstatus confirmed
      const paCheck = await pool.query('SELECT status FROM pending_actions WHERE id = $1', [active.id]);
      expect(paCheck.rows[0].status).toBe('confirmed');

      // Verifikasi transaksi tercatat di database
      const txRes = await pool.query(
        "SELECT t.*, c.name AS category_name FROM transactions t JOIN categories c ON c.id = t.category_id WHERE t.note = 'martabak manis keju' ORDER BY t.id DESC LIMIT 1"
      );
      expect(txRes.rows.length).toBe(1);
      expect(txRes.rows[0].category_name).toBe('Makanan');
      expect(Number(txRes.rows[0].amount)).toBe(35000);

      // Verifikasi kata kunci dipelajari ke category_rules
      const ruleMatch = await findCategoryByRule('beli martabak');
      expect(ruleMatch).not.toBeNull();
      expect(ruleMatch.keyword).toBe('martabak');
      expect(ruleMatch.categoryName).toBe('Makanan');
    });

    it('balasan batal membatalkan pemilihan kategori tanpa mencatat transaksi', async () => {
      await pool.query('DELETE FROM pending_actions');

      // Buat pending action pilih_kategori baru
      const action = {
        tool: 'add_transaction',
        args: {
          type: 'keluar',
          amount: 50000,
          category: null,
          note: 'barang misterius',
        },
      };
      await executeTool(action, {
        messageText: 'barang misterius 50rb',
        confidence: 0.4,
      });

      const active = await getActivePendingAction();
      expect(active).not.toBeNull();

      // Kirim "batal"
      const reply = await simulateUserMessage('batal');
      expect(reply.text).toContain('dibatalkan');

      // Pending action ditandai rejected
      const paCheck = await pool.query('SELECT status FROM pending_actions WHERE id = $1', [active.id]);
      expect(paCheck.rows[0].status).toBe('rejected');

      // Transaksi tidak dibuat
      const txRes = await pool.query("SELECT * FROM transactions WHERE note = 'barang misterius'");
      expect(txRes.rows.length).toBe(0);
    });
  });
});
