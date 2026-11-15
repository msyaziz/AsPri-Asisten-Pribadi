/**
 * Modul Perangkai Jawaban Tanya Data (Respond Agent).
 * Merangkai jawaban ramah dan ringkas HANYA berdasarkan data query backend.
 * Sesuai prd.md §12.2 dan §12.6.
 */

import { chatCompletion } from './groq.js';
import { formatRupiah } from '../utils/rupiah.js';
import { logger } from '../utils/logger.js';

/**
 * Merangkai jawaban untuk pertanyaan data pengguna berdasarkan hasil eksekusi tool baca.
 * @param {object} params
 * @param {string} params.question Pertanyaan asli pengguna
 * @param {object} params.data Data JSON hasil query tool baca
 * @returns {Promise<string>}
 */
export async function respondToDataQuery({ question, data }) {
  const safeDataJson = JSON.stringify(
    data,
    (_, v) => (typeof v === 'bigint' ? Number(v) : v),
    2
  );

  const systemPrompt = `Kamu asisten pribadi yang ramah dan singkat (bahasa Indonesia santai, boleh 1 emoji).
Jawab pertanyaan pengguna HANYA berdasarkan DATA berikut. Dilarang menambah atau menghitung angka yang tidak ada di DATA.
Format rupiah: Rp 25.000. Jika DATA kosong, katakan belum ada data.

DATA:
${safeDataJson}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: question },
  ];

  try {
    const reply = await chatCompletion({
      messages,
      temperature: 0.3,
      maxTokens: 300,
      purpose: 'respond',
    });
    return reply.trim();
  } catch (err) {
    logger.warn({ err: err.message }, 'Gagal merangkai jawaban via AI, menggunakan fallback template');
    return formatFallbackResponse(data);
  }
}

/**
 * Fallback sederhana jika AI sedang tidak dapat dihubungi.
 * Menjamin jawaban tetap akurat dan tidak melanggar aturan angka.
 * @param {object} data
 * @returns {string}
 */
export function formatFallbackResponse(data) {
  if (!data) return 'Maaf, data belum tersedia.';

  if (data.grandTotal !== undefined) {
    let text = `Total uang kamu saat ini: *${formatRupiah(data.grandTotal)}*.\n`;
    text += `• Saldo utama: ${formatRupiah(data.mainBalance || 0)}\n`;
    text += `• Total di kantong: ${formatRupiah(data.pocketTotal ?? data.pocketsTotal ?? 0)}`;
    if (Array.isArray(data.pockets) && data.pockets.length > 0) {
      text += '\n\nRincian kantong:\n';
      text += data.pockets.map((p) => `• ${p.name}: ${formatRupiah(p.balance ?? p.currentBalance ?? 0)}`).join('\n');
    }
    return text;
  }

  if (data.totalSpending !== undefined) {
    let text = `Total pengeluaran (${data.period || 'periode ini'}): *${formatRupiah(data.totalSpending)}*`;
    if (Array.isArray(data.byCategory) && data.byCategory.length > 0) {
      text += '\n\nRincian per kategori:\n';
      text += data.byCategory.map((c) => `• ${c.category}: ${formatRupiah(c.total)} (${c.count}x)`).join('\n');
    }
    return text;
  }

  if (data.totalIncome !== undefined) {
    return `Total pemasukan (${data.period || 'periode ini'}): *${formatRupiah(data.totalIncome)}*`;
  }

  if (Array.isArray(data.transactions)) {
    if (data.transactions.length === 0) return 'Belum ada transaksi pada periode ini.';
    let text = `Daftar transaksi (${data.period}):\n`;
    text += data.transactions
      .map((t) => `• [${t.date}] ${t.type === 'keluar' ? '-' : '+'}${formatRupiah(t.amount)} (${t.category}${t.note ? ' - ' + t.note : ''})`)
      .join('\n');
    return text;
  }

  return JSON.stringify(data);
}
