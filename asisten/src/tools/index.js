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
import { findCategoryByRule, getCategories, getCategoryByName } from '../services/categories.js';
import {
  getSpendingReport,
  getIncomeReport,
  listTransactionsReport,
  getMonthlyFinancialReport,
} from '../services/reports.js';
import { respondToDataQuery } from '../ai/respond.js';
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

  // Untuk add_transaction dengan confidence < 0.6, serahkan ke Lapis 3 (pilih_kategori)
  if (tool === 'add_transaction' && confidence < 0.6) {
    return { needsConfirm: false, reason: null };
  }

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
    periodId = null,
  } = context;

  const currentPeriod = periodId ? { id: periodId } : await ensureCurrentPeriod();

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
      const {
        type = 'keluar',
        amount,
        category: catName,
        categoryId: directCatId,
        pocketId: directPocketId,
        pocket: pocketName,
        note,
        date,
      } = action.args;

      let categoryId = directCatId || null;
      let pocketId = directPocketId || null;

      // Cari kategori dari catName jika belum ada ID
      if (!categoryId && catName) {
        const cat = await getCategoryByName(catName);
        if (cat) {
          categoryId = cat.id;
          pocketId = pocketId || cat.default_pocket_id;
        }
      }

      // Jika kategori belum ketemu, cek aturan kata kunci (category_rules)
      if (!categoryId) {
        const ruleMatch = await findCategoryByRule(note || messageText);
        if (ruleMatch) {
          categoryId = ruleMatch.categoryId;
          pocketId = pocketId || ruleMatch.defaultPocketId;
        }
      }

      // Lapis 3: Tanya Pengguna (confidence < 0.6 atau kategori tidak ditemukan)
      if (!skipConfirmation && (!categoryId || confidence < 0.6)) {
        const activeCategories = await getCategories({
          activeOnly: true,
          type: type === 'masuk' ? 'masuk' : 'keluar',
        });

        if (activeCategories.length > 0) {
          const pa = await createPendingAction({
            type: 'pilih_kategori',
            payload: {
              action: {
                ...action,
                args: { ...action.args, type, amount, note, date },
              },
              context: { ...context, skipConfirmation: true },
              categories: activeCategories.map((c) => ({
                id: c.id,
                name: c.name,
                default_pocket_id: c.default_pocket_id,
                default_pocket_name: c.default_pocket_name,
              })),
            },
            waMessageId,
            botReplyId,
            timeoutMinutes: 10,
          });

          const catListStr = activeCategories
            .map((c, i) => `${i + 1}. ${c.name}${c.default_pocket_name ? ' (' + c.default_pocket_name + ')' : ''}`)
            .join('\n');

          const desc = `${type === 'keluar' ? 'Pengeluaran' : 'Pemasukan'} ${formatRupiah(amount)}${note ? ' (' + note + ')' : ''}`;

          return {
            status: 'pending',
            reply:
              `❓ *Pilih Kategori*\n` +
              `Untuk transaksi: ${desc}\n\n` +
              `Silakan balas dengan nomor kategori:\n${catListStr}\n\n` +
              `Atau ketik *batal* untuk membatalkan.`,
            data: pa,
          };
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

    // ---------- Tool Baca / Tanya Data (Fase 3 & prd.md §12.4) ----------
    case 'get_total_money': {
      const data = await getTotalMoney(currentPeriod.id);
      const pockets = await getPocketBalances(currentPeriod.id);
      const safeData = {
        grandTotal: Number(data.grandTotal),
        mainBalance: Number(data.mainBalance),
        pocketTotal: Number(data.pocketTotal),
        pockets: pockets.map((p) => ({
          name: p.name,
          balance: Number(p.currentBalance),
        })),
      };
      const reply = await respondToDataQuery({
        question: messageText || 'Total uang saya berapa?',
        data: safeData,
      });
      return { status: 'executed', reply, data: safeData };
    }

    case 'get_pocket_balance': {
      const pocketName = action.args?.pocket;
      let safeData;
      if (pocketName) {
        const p = await getPocketByName(pocketName);
        if (!p) throw new Error(`Kantong '${pocketName}' tidak ditemukan.`);
        const bal = await getPocketBalance(currentPeriod.id, p.id);
        safeData = { name: p.name, balance: Number(bal) };
      } else {
        const pockets = await getPocketBalances(currentPeriod.id);
        safeData = pockets.map((p) => ({
          name: p.name,
          balance: Number(p.currentBalance),
          rolloverMode: p.rolloverMode,
        }));
      }
      const reply = await respondToDataQuery({
        question: messageText || 'Berapa saldo kantong?',
        data: safeData,
      });
      return { status: 'executed', reply, data: safeData };
    }

    case 'get_main_balance': {
      const bal = await getMainBalance(currentPeriod.id);
      const safeData = { mainBalance: Number(bal) };
      const reply = await respondToDataQuery({
        question: messageText || 'Berapa saldo utama saya?',
        data: safeData,
      });
      return { status: 'executed', reply, data: safeData };
    }

    case 'get_spending': {
      const data = await getSpendingReport({
        range: action.args?.range,
        dateFrom: action.args?.date_from,
        dateTo: action.args?.date_to,
        category: action.args?.category,
        pocket: action.args?.pocket,
      });
      const reply = await respondToDataQuery({
        question: messageText || 'Berapa pengeluaran saya?',
        data,
      });
      return { status: 'executed', reply, data };
    }

    case 'get_income': {
      const data = await getIncomeReport({
        range: action.args?.range,
        dateFrom: action.args?.date_from,
        dateTo: action.args?.date_to,
      });
      const reply = await respondToDataQuery({
        question: messageText || 'Berapa pemasukan saya?',
        data,
      });
      return { status: 'executed', reply, data };
    }

    case 'list_transactions': {
      const data = await listTransactionsReport({
        range: action.args?.range,
        dateFrom: action.args?.date_from,
        dateTo: action.args?.date_to,
        limit: action.args?.limit,
        type: action.args?.type,
        pocket: action.args?.pocket,
        category: action.args?.category,
      });
      const reply = await respondToDataQuery({
        question: messageText || 'Daftar transaksi saya',
        data,
      });
      return { status: 'executed', reply, data };
    }

    case 'get_monthly_report': {
      const data = await getMonthlyFinancialReport({
        year: action.args?.year,
        month: action.args?.month,
      });
      const reply = await respondToDataQuery({
        question: messageText || 'Laporan bulanan saya',
        data,
      });
      return { status: 'executed', reply, data };
    }

    default:
      throw new Error(`Tool tidak dikenali: ${action.tool}`);
  }
}
