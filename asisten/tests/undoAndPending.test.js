import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../src/db/pool.js';
import { ensurePeriod, getMainBalance } from '../src/services/periods.js';
import { getPocketByName, getPocketBalance } from '../src/services/pockets.js';
import { addTransaction } from '../src/services/transactions.js';
import { transferBetweenPockets } from '../src/services/transfers.js';
import {
  createPendingAction,
  getActivePendingAction,
  resolvePendingAction,
} from '../src/services/pendingActions.js';
import {
  getLastUndoableAction,
  undoAction,
  getLastTransaction,
  reviseLastTransaction,
} from '../src/services/undo.js';

describe('Fase 2 - Pending Actions & Undo / Koreksi (Checkpoint E)', () => {
  let testPeriod;
  let pocketHiburan;
  let pocketKebutuhan;

  beforeAll(async () => {
    // Gunakan tahun 2096 untuk isolasi test
    testPeriod = await ensurePeriod(2096, 1);
    pocketHiburan = await getPocketByName('Hiburan');
    pocketKebutuhan = await getPocketByName('Kebutuhan');

    // Bersihkan data tahun 2096
    await pool.query('DELETE FROM pending_actions');
    await pool.query(
      'DELETE FROM action_log WHERE entity_id IN (SELECT id FROM transactions WHERE period_id = $1)',
      [testPeriod.id]
    );
    await pool.query('DELETE FROM pocket_transfers WHERE period_id = $1', [testPeriod.id]);
    await pool.query('DELETE FROM transactions WHERE period_id = $1', [testPeriod.id]);
    await pool.query('DELETE FROM period_pockets WHERE period_id = $1', [testPeriod.id]);

    // Beri modal awal di kantong Hiburan dan Kebutuhan
    await pool.query(
      `INSERT INTO period_pockets (period_id, pocket_id, alloc_percent, alloc_amount, rollover_in)
       VALUES
         ($1, $2, 0, 500000, 0),
         ($1, $3, 0, 500000, 0)`,
      [testPeriod.id, pocketHiburan.id, pocketKebutuhan.id]
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM pending_actions');
    await pool.query(
      'DELETE FROM action_log WHERE entity_id IN (SELECT id FROM transactions WHERE period_id = $1)',
      [testPeriod.id]
    );
    await pool.query('DELETE FROM pocket_transfers WHERE period_id = $1', [testPeriod.id]);
    await pool.query('DELETE FROM transactions WHERE period_id = $1', [testPeriod.id]);
    await pool.query('DELETE FROM period_pockets WHERE period_id = $1', [testPeriod.id]);
    await pool.query('DELETE FROM periods WHERE id = $1', [testPeriod.id]);
  });

  describe('Pending Actions', () => {
    it('membuat pending action baru dan mengambilnya', async () => {
      const pa = await createPendingAction({
        type: 'transaksi_besar',
        payload: { amount: 1500000, note: 'makan siang mewah' },
        waMessageId: 'msg_123',
        botReplyId: 'bot_reply_123',
      });

      expect(pa.id).toBeDefined();
      expect(pa.status).toBe('waiting');

      const active = await getActivePendingAction();
      expect(active).toBeDefined();
      expect(active.id).toBe(pa.id);
      expect(active.type).toBe('transaksi_besar');
    });

    it('mengonfirmasi pending action (resolve confirmed)', async () => {
      const active = await getActivePendingAction();
      const resolved = await resolvePendingAction(active.id, 'confirmed');
      expect(resolved.status).toBe('confirmed');

      const afterResolve = await getActivePendingAction();
      expect(afterResolve).toBeNull();
    });

    it('secara otomatis mengabaikan pending action yang kedaluwarsa', async () => {
      // Buat pending action yang sudah lewat waktu (-1 menit)
      const res = await pool.query(
        `INSERT INTO pending_actions (type, payload, status, expires_at)
         VALUES ('test_expired', '{}', 'waiting', now() - interval '1 minute')
         RETURNING *`
      );
      const expiredId = res.rows[0].id;

      const active = await getActivePendingAction();
      expect(active).toBeNull();

      const check = await pool.query('SELECT status FROM pending_actions WHERE id = $1', [
        expiredId,
      ]);
      expect(check.rows[0].status).toBe('expired');
    });
  });

  describe('Undo & Koreksi (batal / ralat)', () => {
    it('membatalkan transaksi terakhir (undo action) dan memulihkan saldo', async () => {
      // Saldo Hiburan awal: 500.000
      const initialBal = (await getPocketBalance(testPeriod.id, pocketHiburan.id)).balance;
      expect(initialBal).toBe(500000n);

      // 1. Buat transaksi kopi 18rb
      const tx = await addTransaction({
        periodId: testPeriod.id,
        type: 'keluar',
        amount: 18000,
        pocketId: pocketHiburan.id,
        note: 'kopi siang',
        txDate: '2096-01-05',
        botReplyId: 'reply_kopi_1',
      });

      // Saldo setelah transaksi: 500.000 - 18.000 = 482.000
      const balAfter = (await getPocketBalance(testPeriod.id, pocketHiburan.id)).balance;
      expect(balAfter).toBe(482000n);

      // 2. Ambil aksi terakhir yang bisa dibatalkan
      const lastAction = await getLastUndoableAction();
      expect(lastAction).toBeDefined();
      expect(lastAction.entity).toBe('transaction');
      expect(lastAction.action).toBe('create');
      expect(lastAction.entity_id).toBe(tx.id.toString());

      // 3. Batalkan aksi (undo)
      const undoRes = await undoAction(lastAction.id);
      expect(undoRes.success).toBe(true);

      // 4. Saldo Hiburan pulih kembali ke 500.000
      const balRestored = (await getPocketBalance(testPeriod.id, pocketHiburan.id)).balance;
      expect(balRestored).toBe(500000n);
    });

    it('membatalkan transaksi spesifik via reply (botReplyId)', async () => {
      // Buat transaksi A dan transaksi B
      const txA = await addTransaction({
        periodId: testPeriod.id,
        type: 'keluar',
        amount: 25000,
        pocketId: pocketHiburan.id,
        note: 'transaksi A',
        botReplyId: 'reply_tx_A',
      });

      const txB = await addTransaction({
        periodId: testPeriod.id,
        type: 'keluar',
        amount: 30000,
        pocketId: pocketHiburan.id,
        note: 'transaksi B',
        botReplyId: 'reply_tx_B',
      });

      // User membalas (reply) pesan bot txA dengan "batal"
      const actionA = await getLastUndoableAction({ botReplyId: 'reply_tx_A' });
      expect(actionA).toBeDefined();
      expect(actionA.entity_id).toBe(txA.id.toString());

      await undoAction(actionA.id);

      // Pastikan txA sudah terhapus (deleted_at NOT NULL)
      const checkA = await pool.query('SELECT deleted_at FROM transactions WHERE id = $1', [
        txA.id,
      ]);
      expect(checkA.rows[0].deleted_at).not.toBeNull();

      // txB masih aktif
      const checkB = await pool.query('SELECT deleted_at FROM transactions WHERE id = $1', [
        txB.id,
      ]);
      expect(checkB.rows[0].deleted_at).toBeNull();
    });

    it('meralat nominal transaksi terakhir (ralat jadi 30rb)', async () => {
      // Ambil transaksi terakhir (txB senilai 30.000)
      const lastTx = await getLastTransaction();
      expect(lastTx).toBeDefined();
      expect(lastTx.amount).toBe(30000n);

      // Ralat jadi 45.000
      const { previous, updated } = await reviseLastTransaction({
        amount: 45000,
        note: 'transaksi B diralat',
      });

      expect(previous.amount).toBe(30000n);
      expect(updated.amount).toBe(45000n);
      expect(updated.note).toBe('transaksi B diralat');

      // Verifikasi di action_log bahwa nilai lama tersimpan di before_data
      const logRes = await pool.query(
        "SELECT * FROM action_log WHERE entity = 'transaction' AND entity_id = $1 AND action = 'update' ORDER BY id DESC LIMIT 1",
        [updated.id]
      );
      expect(logRes.rows.length).toBe(1);
      const beforeData =
        typeof logRes.rows[0].before_data === 'string'
          ? JSON.parse(logRes.rows[0].before_data)
          : logRes.rows[0].before_data;
      expect(BigInt(beforeData.amount)).toBe(30000n);
    });

    it('membatalkan transfer antar kantong dan memulihkan saldo kedua kantong', async () => {
      const balKebAwal = (await getPocketBalance(testPeriod.id, pocketKebutuhan.id)).balance;
      const balHibAwal = (await getPocketBalance(testPeriod.id, pocketHiburan.id)).balance;

      // Transfer 50.000 dari Kebutuhan ke Hiburan
      const tr = await transferBetweenPockets({
        periodId: testPeriod.id,
        fromPocketId: pocketKebutuhan.id,
        toPocketId: pocketHiburan.id,
        amount: 50000,
        note: 'transfer uji',
      });

      // Saldo setelah transfer
      expect((await getPocketBalance(testPeriod.id, pocketKebutuhan.id)).balance).toBe(
        balKebAwal - 50000n
      );
      expect((await getPocketBalance(testPeriod.id, pocketHiburan.id)).balance).toBe(
        balHibAwal + 50000n
      );

      // Ambil aksi transfer terakhir
      const lastAction = await getLastUndoableAction();
      expect(lastAction.entity).toBe('transfer');

      // Batalkan transfer
      await undoAction(lastAction.id);

      // Saldo kedua kantong pulih sempurna
      expect((await getPocketBalance(testPeriod.id, pocketKebutuhan.id)).balance).toBe(
        balKebAwal
      );
      expect((await getPocketBalance(testPeriod.id, pocketHiburan.id)).balance).toBe(
        balHibAwal
      );
    });
  });
});

