/**
 * Eksekutor Tool Keuangan (Fase 2).
 * Sesuai prd.md §12.1-12.4, §8.3-8.7 dan 02-fase2-keuangan-inti.md.
 */

import { pool } from '../db/pool.js';
import { ensureCurrentPeriod, getMainBalance, getTotalMoney } from '../services/periods.js';
import {
  getActivePockets,
  getPocketByName,
  getPocketBalance,
  getPocketBalances,
  createPocket,
  renamePocket,
  setPocketActive,
  setRolloverMode,
  setAllocations,
} from '../services/pockets.js';
import { addTransaction, setMonthlyIncome } from '../services/transactions.js';
import { transferBetweenPockets } from '../services/transfers.js';
import { createPendingAction } from '../services/pendingActions.js';
import { formatRupiah, extractRupiah } from '../utils/rupiah.js';
import { matchCategoryRule } from '../ai/understand.js';
import { logger } from '../utils/logger.js';

/**
 * Memeriksa apakah sebuah aksi memerlukan konfirmasi pengguna via pending_actions.
 * Kriteria: nominal >= Rp 1.000.000, confidence < 0.7, nominal AI ≠ regex parser.
 * @param {object} action
 * @param {number} confidence
 * @param {string} originalText
 * @returns {{ needsConfirm: boolean, reason: string|null }}
 */
function checkNeedsConfirmation(action, confidence, originalText) {
  const tool = action.tool;
  const args = action.args;

  // 1. Confidence AI rendah (< 0.7)
  if (confidence < 0.7) {
    return {
      needsConfirm: true,
      reason: 'Keyakinan AI terhadap pesan di bawah ambang batas (confidence < 0.7).',
    };
  }

  // 2. Cross-check nominal jika action add_transaction
  if (tool === 'add_transaction' && args.amount) {
    const aiAmount = Number(args.amount);

    // Cek ambang transaksi besar (>= Rp 1.000.000)
    if (aiAmount >= 1_000_000) {
      return {
        needsConfirm: true,
        reason: `Nominal transaksi ${formatRupiah(aiAmount)} cukup besar (≥ Rp 1.000.000).`,
      };
    }

    // Cek kecocokan nominal dengan regex extractor
    const extracted = extractRupiah(originalText);
    if (extracted.length > 0 && !extracted.includes(aiAmount)) {
      return {
        needsConfirm: true,
        reason: `Nominal hasil AI (${formatRupiah(aiAmount)}) berbeda dengan pembacaan teks (${extracted.map(formatRupiah).join(', ')}).`,
      };
    }
  }

  return { needsConfirm: false, reason: null };
}

/**
 * Eksekusi satu aksi tool yang dipilih oleh AI atau dikonfirmasi dari pending_actions.
 * @param {object} action { tool: string, args: object }
 * @param {object} context
 * @param {string} context.messageText
 * @param {number} [context.confidence=1.0]
 * @param {string} [context.waMessageId]
 * @param {string} [context.botReplyId]
 * @param {boolean} [context.skipConfirmation=false]
 * @returns {Promise<{ status: 'executed'|'pending', reply: string, data?: any }>}
 */
export async function executeTool(action, context = {}) {
  const {
    messageText = '',
    confidence = 1.0,
    waMessageId = null,
    botReplyId = null,
    skipConfirmation = false,
  } = context;

  const currentPeriod = await ensureCurrentPeriod();

  // 1. Cek apakah aksi memerlukan konfirmasi (jika belum dilewati lewat "ya")
  if (!skipConfirmation) {
    const { needsConfirm, reason } = checkNeedsConfirmation(action, confidence, messageText);
    if (needsConfirm) {
      const pa = await createPendingAction({
        type: 'konfirmasi_aksi',
        payload: { action, context: { ...context, skipConfirmation: true } },
        waMessageId,
        botReplyId,
        timeoutMinutes: 10,
      });

      let confirmDesc = 'aksi ini';
      if (action.tool === 'add_transaction') {
        confirmDesc = `${action.args.type === 'keluar' ? 'pengeluaran' : 'pemasukan'} senilai ${formatRupiah(action.args.amount)}${action.args.note ? ' untuk ' + action.args.note : ''}`;
      } else if (action.tool === 'set_monthly_income') {
        confirmDesc = `uang bulanan sebesar ${formatRupiah(action.args.amount)}`;
      } else if (action.tool === 'transfer_between_pockets') {
        confirmDesc = `transfer ${formatRupiah(action.args.amount)} dari ${action.args.from || 'Saldo Utama'} ke ${action.args.to || 'Saldo Utama'}`;
      }

      return {
        status: 'pending',
        reply:
          `⚠️ *Perlu Konfirmasi*\n${reason}\n\n` +
          `Apakah kamu yakin ingin mencatat ${confirmDesc}?\n` +
          `Balas *ya* untuk lanjut, atau *tidak* untuk batalkan (berlaku 10 menit).`,
        data: pa,
      };
    }
  }

  // 2. Eksekusi tool sesuai nama tool
  switch (action.tool) {
    case 'add_transaction': {
      const { type, amount, category: catName, pocket: pocketName, note, date } = action.args;

      let categoryId = null;
      let pocketId = null;

      // Cari kategori
      if (catName) {
        const catRes = await pool.query(
          'SELECT id, default_pocket_id FROM categories WHERE LOWER(name) = LOWER($1)',
          [catName.trim()]
        );
        if (catRes.rows.length > 0) {
          categoryId = catRes.rows[0].id;
          pocketId = catRes.rows[0].default_pocket_id;
        }
      }

      // Jika kategori belum ketemu, cek aturan kata kunci (category_rules)
      if (!categoryId) {
        const ruleMatch = await matchCategoryRule(note || messageText);
        if (ruleMatch) {
          const catRes = await pool.query(
            'SELECT id, default_pocket_id FROM categories WHERE LOWER(name) = LOWER($1)',
            [ruleMatch.categoryName]
          );
          if (catRes.rows.length > 0) {
            categoryId = catRes.rows[0].id;
            pocketId = catRes.rows[0].default_pocket_id;
          }
        }
      }

      // Jika ada nama kantong eksplisit di argumen, gunakan kantong itu
      if (pocketName) {
        const p = await getPocketByName(pocketName);
        if (p) pocketId = p.id;
      }

      const tx = await addTransaction({
        periodId: currentPeriod.id,
        type,
        amount,
        categoryId,
        pocketId,
        note,
        txDate: date || undefined,
        waMessageId,
        botReplyId,
      });

      // Ambil saldo kantong setelah transaksi untuk balasan template
      let pocketInfo = '';
      if (pocketId) {
        const pBal = await getPocketBalance(currentPeriod.id, pocketId);
        if (pBal) {
          pocketInfo = `\nSisa kantong *${pBal.pocketName}*: ${formatRupiah(pBal.balance)}`;
          if (pBal.balance < 0n) {
            pocketInfo += ' ⚠️ *(Kantong overspent/minus)*';
          }
        }
      } else {
        const mainBal = await getMainBalance(currentPeriod.id);
        pocketInfo = `\nSisa *Saldo Utama*: ${formatRupiah(mainBal)}`;
      }

      const typeLabel = type === 'keluar' ? 'Pengeluaran' : 'Pemasukan';
      const noteLabel = note ? ` (${note})` : '';
      return {
        status: 'executed',
        reply: `✅ *${typeLabel} Berhasil Dicatat*\nNominal: ${formatRupiah(amount)}${noteLabel}${pocketInfo}`,
        data: tx,
      };
    }

    case 'set_monthly_income': {
      const { amount, mode } = action.args;
      const res = await setMonthlyIncome({
        periodId: currentPeriod.id,
        amount,
        mode: mode || 'tambah',
        waMessageId,
        botReplyId,
      });

      const allocLines = res.allocations
        .filter((a) => a.percent > 0)
        .map((a) => `• *${a.pocketName}* (${a.percent}%): ${formatRupiah(a.allocAmount)}`);

      return {
        status: 'executed',
        reply:
          `✅ *Uang Bulanan Berhasil Dicatat*\n` +
          `Nominal: ${formatRupiah(amount)}\n\n` +
          `*Pembagian Alokasi Kantong:*\n` +
          (allocLines.length > 0 ? allocLines.join('\n') : '• (Belum ada persentase alokasi)') +
          `\n\n🏦 *Saldo Utama:* ${formatRupiah(res.mainBalance)}` +
          `\n💰 *Total Uang:* ${formatRupiah(res.totalMoney.grandTotal)}`,
        data: res,
      };
    }

    case 'set_allocation': {
      const { items } = action.args;
      const res = await setAllocations(
        currentPeriod.id,
        items.map((i) => ({ pocketName: i.pocket, percent: i.percent, amount: i.amount }))
      );

      const lines = res.updatedPockets
        .filter((p) => p.allocPercent > 0)
        .map((p) => `• *${p.pocketName}*: ${p.allocPercent}% (${formatRupiah(p.allocAmount)})`);

      return {
        status: 'executed',
        reply:
          `✅ *Alokasi Kantong Diterapkan* (Total: ${res.totalPercent}%):\n` +
          lines.join('\n'),
        data: res,
      };
    }

    case 'transfer_between_pockets': {
      const { from, to, amount, note } = action.args;

      let fromPocketId = null;
      let toPocketId = null;

      if (from && from.toLowerCase() !== 'utama') {
        const p = await getPocketByName(from);
        if (!p) throw new Error(`Kantong asal '${from}' tidak ditemukan.`);
        fromPocketId = p.id;
      }

      if (to && to.toLowerCase() !== 'utama') {
        const p = await getPocketByName(to);
        if (!p) throw new Error(`Kantong tujuan '${to}' tidak ditemukan.`);
        toPocketId = p.id;
      }

      try {
        const res = await transferBetweenPockets({
          periodId: currentPeriod.id,
          fromPocketId,
          toPocketId,
          amount,
          note,
          botReplyId,
        });

        return {
          status: 'executed',
          reply:
            `✅ *Transfer Berhasil*\n` +
            `Pindah ${formatRupiah(amount)} dari *${res.fromName}* ke *${res.toName}*.\n\n` +
            `• Sisa ${res.fromName}: ${formatRupiah(res.fromBalanceAfter)}\n` +
            `• Sisa ${res.toName}: ${formatRupiah(res.toBalanceAfter)}`,
          data: res,
        };
      } catch (err) {
        return {
          status: 'executed',
          reply: `❌ Transfer ditolak: ${err.message}`,
        };
      }
    }

    case 'create_pocket': {
      const { name, rollover_mode } = action.args;
      const pocket = await createPocket({ name, rolloverMode: rollover_mode || 'carry' });
      return {
        status: 'executed',
        reply: `✅ Kantong baru *${pocket.name}* berhasil dibuat dengan mode rollover *${pocket.rollover_mode}*.`,
        data: pocket,
      };
    }

    case 'rename_pocket': {
      const { old_name, new_name } = action.args;
      const p = await getPocketByName(old_name);
      if (!p) throw new Error(`Kantong '${old_name}' tidak ditemukan.`);
      const updated = await renamePocket(p.id, new_name);
      return {
        status: 'executed',
        reply: `✅ Kantong *${old_name}* berhasil diubah namanya menjadi *${updated.name}*.`,
        data: updated,
      };
    }

    case 'set_pocket_active': {
      const { name, is_active } = action.args;
      const p = await getPocketByName(name);
      if (!p) throw new Error(`Kantong '${name}' tidak ditemukan.`);
      const updated = await setPocketActive(p.id, is_active);
      return {
        status: 'executed',
        reply: `✅ Kantong *${name}* sekarang ${updated.is_active ? 'aktif' : 'dinonaktifkan'}.`,
        data: updated,
      };
    }

    case 'set_rollover_mode': {
      const { pocket: pocketName, mode } = action.args;
      const updated = await setRolloverMode(pocketName, mode);
      const modeDesc = mode === 'carry' ? 'dibawa ke bulan depan' : 'dikembalikan ke saldo utama';
      return {
        status: 'executed',
        reply: `✅ Mode rollover kantong *${updated.name}* diatur ke *${modeDesc}* (${mode}).`,
        data: updated,
      };
    }

    default:
      throw new Error(`Tool tidak dikenali: ${action.tool}`);
  }
}
