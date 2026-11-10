import { pool } from '../db/pool.js';
import { CONSTANTS } from '../config/constants.js';
import { logger } from '../utils/logger.js';

/**
 * Mengambil N riwayat percakapan terakhir dalam urutan kronologis.
 * @param {number} [limit=CONSTANTS.CHAT_HISTORY_CONTEXT_LIMIT]
 * @returns {Promise<Array<{ role: 'user'|'assistant', content: string }>>}
 */
export async function getRecentHistory(limit = CONSTANTS.CHAT_HISTORY_CONTEXT_LIMIT) {
  try {
    const { rows } = await pool.query(
      'SELECT role, content FROM chat_history ORDER BY id DESC LIMIT $1',
      [limit]
    );
    // Balik urutan agar kronologis dari yang terlama ke terbaru
    return rows.reverse();
  } catch (err) {
    logger.error({ err: err.message }, 'Gagal mengambil chat_history');
    return [];
  }
}

/**
 * Menyimpan pesan baru ke tabel chat_history dan memangkas kelebihan baris (>200).
 * @param {'user'|'assistant'} role
 * @param {string} content
 * @returns {Promise<void>}
 */
export async function addChatMessage(role, content) {
  try {
    await pool.query('INSERT INTO chat_history (role, content) VALUES ($1, $2)', [role, content]);

    // Pangkas baris agar tabel tidak membengkak (retensi 200 baris)
    await pool.query(
      `DELETE FROM chat_history
       WHERE id NOT IN (
         SELECT id FROM chat_history ORDER BY id DESC LIMIT $1
       )`,
      [CONSTANTS.CHAT_HISTORY_RETENTION_LIMIT]
    );
  } catch (err) {
    logger.error({ err: err.message }, 'Gagal menyimpan chat_history');
  }
}

/**
 * Menghapus seluruh riwayat percakapan.
 * @returns {Promise<void>}
 */
export async function clearHistory() {
  await pool.query('DELETE FROM chat_history');
}
