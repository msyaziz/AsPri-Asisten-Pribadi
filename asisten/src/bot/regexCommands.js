import { pool } from '../db/pool.js';

/**
 * Format detik menjadi teks waktu ringkas (mis. 2 jam 15 menit).
 * @param {number} seconds
 * @returns {string}
 */
function formatUptime(seconds) {
  const sec = Math.floor(seconds);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;

  const parts = [];
  if (h > 0) parts.push(`${h} jam`);
  if (m > 0) parts.push(`${m} menit`);
  parts.push(`${s} detik`);

  return parts.join(' ');
}

/**
 * Memeriksa dan mengeksekusi perintah cepat berbasis regex (fast-path tanpa AI).
 * Spesifikasi: docs/01-fase1-bot-dasar.md bagian 8.8
 *
 * @param {string} text
 * @returns {Promise<string|null>} Balasan teks atau null jika bukan perintah regex
 */
export async function handleRegexCommand(text) {
  if (!text || typeof text !== 'string') return null;
  const normalized = text.trim().toLowerCase();

  // 1. Perintah: ping
  if (normalized === 'ping') {
    const uptimeStr = formatUptime(process.uptime());
    return `pong 🏓\nUptime: ${uptimeStr}`;
  }

  // 2. Perintah: bantuan atau menu
  if (normalized === 'bantuan' || normalized === 'menu') {
    return (
      `*Halo! Aku AsPri (Asisten Pribadi)* 🤖\n\n` +
      `Saat ini aku berada di *Fase 1* (Bot Dasar):\n` +
      `• *Ngobrol Santai*: Tanya atau ajak ngobrol bebas denganku.\n` +
      `• *ping*: Cek status koneksi dan uptime bot.\n` +
      `• *reset*: Bersihkan memori riwayat obrolan kita.\n` +
      `• *bantuan* / *menu*: Tampilkan bantuan ini.\n\n` +
      `_Catatan: Fitur keuangan (kantong & transaksi), agenda jadwal, dan dashboard web segera hadir di fase berikutnya._`
    );
  }

  // 3. Perintah: reset
  if (normalized === 'reset') {
    try {
      await pool.query('DELETE FROM chat_history');
      return 'Riwayat obrolan dibersihkan.';
    } catch (err) {
      return 'Gagal membersihkan riwayat obrolan. Coba lagi nanti ya.';
    }
  }

  return null;
}

export default handleRegexCommand;
