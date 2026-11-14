import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { pool } from '../src/db/pool.js';
import * as senderModule from '../src/bot/sender.js';
import { processSingleMessage } from '../src/bot/router.js';
import { ensureCurrentPeriod, getMainBalance, getTotalMoney } from '../src/services/periods.js';
import { getPocketByName, getPocketBalance } from '../src/services/pockets.js';
import { getActivePendingAction } from '../src/services/pendingActions.js';

describe('Fase 2 - Skenario Uji End-to-End WhatsApp (Checkpoint F)', () => {
  vi.setConfig({ testTimeout: 30000 });
  const WHITELIST_JID = '6285642060441@s.whatsapp.net';
  let sentReplies = [];
  let currentPeriod;

  // Helper untuk mengirimkan pesan WhatsApp tiruan
  async function simulateUserMessage(text, quotedStanzaId = null) {
    const repliesBefore = sentReplies.length;
    const msgId = `msg_user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const msg = {
      key: {
        remoteJid: WHITELIST_JID,
        fromMe: false,
        id: msgId,
      },
      message: quotedStanzaId
        ? {
            extendedTextMessage: {
              text,
              contextInfo: { stanzaId: quotedStanzaId },
            },
          }
        : {
            conversation: text,
          },
    };

    await processSingleMessage(msg);
    const newReplies = sentReplies.slice(repliesBefore);
    return newReplies[newReplies.length - 1] || null;
  }

  beforeAll(async () => {
    // Mock sendText agar tidak perlu Baileys socket sungguhan saat unit test
    vi.spyOn(senderModule, 'sendText').mockImplementation(async (_jid, text) => {
      const botMsgId = `bot_reply_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      sentReplies.push({ text, botMsgId });
      return [botMsgId];
    });

    currentPeriod = await ensureCurrentPeriod();

    // Pastikan database dalam kondisi bersih untuk testing
    await pool.query('DELETE FROM pending_actions');
    await pool.query('DELETE FROM action_log');
    await pool.query('DELETE FROM pocket_transfers');
    await pool.query('DELETE FROM transactions');
    await pool.query('DELETE FROM processed_messages');
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await pool.query('DELETE FROM pending_actions');
    await pool.query('DELETE FROM action_log');
    await pool.query('DELETE FROM pocket_transfers');
    await pool.query('DELETE FROM transactions');
    await pool.query('DELETE FROM processed_messages');
  });

  it('1. Perintah: "uang bulanan 3 juta" tercatat', async () => {
    const lastReply = await simulateUserMessage('uang bulanan 3 juta');
    expect(lastReply).toBeDefined();
    expect(lastReply.text).toContain('Uang Bulanan Berhasil Dicatat');
    expect(lastReply.text).toContain('Rp 3.000.000');
  });

  it('2. Perintah: "bagi 50% kebutuhan, 20% tabungan, 30% hiburan" menerapkan alokasi', async () => {
    const lastReply = await simulateUserMessage('bagi 50% kebutuhan, 20% tabungan, 30% hiburan');
    expect(lastReply).toBeDefined();
    expect(lastReply.text).toContain('Alokasi Kantong Diterapkan');
    expect(lastReply.text).toContain('Kebutuhan');
    expect(lastReply.text).toContain('50%');

    // Verifikasi saldo kantong terbagi dengan benar dari 3jt:
    // Kebutuhan: 1.500.000, Tabungan: 600.000, Hiburan: 900.000
    const pKeb = await getPocketByName('Kebutuhan');
    const balKeb = await getPocketBalance(currentPeriod.id, pKeb.id);
    expect(balKeb.balance).toBe(1500000n);

    const pHib = await getPocketByName('Hiburan');
    const balHib = await getPocketBalance(currentPeriod.id, pHib.id);
    expect(balHib.balance).toBe(900000n);
  });

  it('3. Perintah: "kopi 18rb" mencatat pengeluaran di kantong Hiburan dari template', async () => {
    const lastReply = await simulateUserMessage('kopi 18rb');
    expect(lastReply).toBeDefined();
    expect(lastReply.text).toContain('Pengeluaran Berhasil Dicatat');
    expect(lastReply.text).toContain('Rp 18.000');

    const pHib = await getPocketByName('Hiburan');
    const balHib = await getPocketBalance(currentPeriod.id, pHib.id);
    // Hiburan 900.000 - 18.000 = 882.000
    expect(balHib.balance).toBe(882000n);
  });

  it('4. Perintah: "makan siang 1,5 juta" meminta konfirmasi (≥ ambang); "ya" menyimpan', async () => {
    // Kirim nominal >= Rp 1.000.000
    const confirmPrompt = await simulateUserMessage('makan siang 1,5 juta');
    expect(confirmPrompt).toBeDefined();
    expect(confirmPrompt.text).toContain('Perlu Konfirmasi');
    expect(confirmPrompt.text).toContain('Rp 1.500.000');
    expect(confirmPrompt.text).toContain('Balas *ya* untuk lanjut');

    // Pending action harus aktif
    const pending = await getActivePendingAction();
    expect(pending).not.toBeNull();

    // Kirim konfirmasi "ya"
    const savedReply = await simulateUserMessage('ya');
    expect(savedReply).toBeDefined();
    expect(savedReply.text).toContain('Pengeluaran Berhasil Dicatat');
    expect(savedReply.text).toContain('Rp 1.500.000');

    // Pending action sudah diselesaikan
    expect(await getActivePendingAction()).toBeNull();
  });

  it('5. Perintah: "pindah 100rb dari hiburan ke kebutuhan" mengubah saldo dua kantong', async () => {
    const lastReply = await simulateUserMessage('pindah 100rb dari hiburan ke kebutuhan');
    expect(lastReply).toBeDefined();
    expect(lastReply.text).toContain('Transfer Berhasil');
    expect(lastReply.text).toContain('Rp 100.000');
    expect(lastReply.text).toContain('Hiburan');
    expect(lastReply.text).toContain('Kebutuhan');

    const pHib = await getPocketByName('Hiburan');
    const balHib = await getPocketBalance(currentPeriod.id, pHib.id);
    // Hiburan: 882.000 - 100.000 = 782.000
    expect(balHib.balance).toBe(782000n);
  });

  it('6. Perintah: "pindah 99 juta dari hiburan ke kebutuhan" ditolak karena saldo tidak cukup', async () => {
    const lastReply = await simulateUserMessage('pindah 99 juta dari hiburan ke kebutuhan');
    expect(lastReply).toBeDefined();
    expect(lastReply.text).toMatch(/ditolak|tidak mencukupi/i);
  });

  it('7. Perintah: "batal" membatalkan transaksi terakhir dan memulihkan saldo', async () => {
    // Buat transaksi kecil untuk dibatalkan: "beli snack 10rb"
    await simulateUserMessage('beli snack 10rb');

    const cancelReply = await simulateUserMessage('batal');
    expect(cancelReply).toBeDefined();
    expect(cancelReply.text).toContain('berhasil dibatalkan');
    expect(cancelReply.text).toContain('Saldo telah dipulihkan');
  });

  it('8. Perintah: reply pesan konfirmasi lama + "batal" membatalkan aksi spesifik', async () => {
    // Ambil botReplyId dari transaksi kopi 18rb sebelumnya
    const txs = await pool.query(
      "SELECT id, bot_reply_id FROM transactions WHERE note = 'kopi' AND deleted_at IS NULL"
    );
    expect(txs.rows.length).toBeGreaterThan(0);
    const targetBotReplyId = txs.rows[0].bot_reply_id;

    // Simulasikan reply ke pesan tersebut
    const cancelReply = await simulateUserMessage('batal', targetBotReplyId);
    expect(cancelReply).toBeDefined();
    expect(cancelReply.text).toContain('berhasil dibatalkan');

    // Transaksi kopi sekarang sudah berstatus deleted_at NOT NULL
    const checkTx = await pool.query('SELECT deleted_at FROM transactions WHERE id = $1', [
      txs.rows[0].id,
    ]);
    expect(checkTx.rows[0].deleted_at).not.toBeNull();
  });

  it('9. Perintah: "ralat jadi 30rb" mengubah transaksi terakhir', async () => {
    // Buat transaksi untuk diralat: "beli bensin 25.000"
    await simulateUserMessage('beli bensin 25.000');

    const ralatReply = await simulateUserMessage('ralat jadi 30rb');
    expect(ralatReply).toBeDefined();
    expect(ralatReply.text).toContain('Transaksi terakhir berhasil diralat');
    expect(ralatReply.text).toContain('Rp 25.000');
    expect(ralatReply.text).toContain('Rp 30.000');
  });

  it('10. Perintah: "saldo" / "kantong" menampilkan ringkasan tanpa AI', async () => {
    const saldoReply = await simulateUserMessage('saldo');
    expect(saldoReply).toBeDefined();
    expect(saldoReply.text).toContain('Ringkasan Saldo Saat Ini');
    expect(saldoReply.text).toContain('Saldo Utama');
    expect(saldoReply.text).toContain('Total Uang');

    const kantongReply = await simulateUserMessage('kantong');
    expect(kantongReply).toBeDefined();
    expect(kantongReply.text).toContain('Ringkasan Saldo Saat Ini');
  });

  it('11. Perintah: "rollover tabungan dibawa" mengubah mode kantong', async () => {
    const lastReply = await simulateUserMessage('rollover tabungan dibawa');
    expect(lastReply).toBeDefined();
    expect(lastReply.text).toContain('Mode rollover kantong *Tabungan* diatur');
    expect(lastReply.text).toContain('carry');

    const pTab = await getPocketByName('Tabungan');
    expect(pTab.rollover_mode).toBe('carry');
  });
});
