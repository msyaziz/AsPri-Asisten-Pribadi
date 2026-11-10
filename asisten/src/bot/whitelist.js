import env from '../config/env.js';
import { pool } from '../db/pool.js';
import { logger } from '../utils/logger.js';
import { normalizeJid } from '../utils/jid.js';
import { CONSTANTS } from '../config/constants.js';
import { incrementDroppedCount } from './connection.js';

let cachedWhitelist = null;
let lastCacheTime = 0;

/**
 * Mengambil konfigurasi whitelist dari database (tabel settings) dengan fallback ke .env.
 * Menggunakan in-memory cache selama 60 detik.
 * @returns {Promise<{ whitelistJid: string, whitelistLid: string }>}
 */
export async function getWhitelistConfig() {
  const now = Date.now();
  if (cachedWhitelist && now - lastCacheTime < CONSTANTS.SETTINGS_CACHE_TTL_MS) {
    return cachedWhitelist;
  }

  let dbJid = '';
  let dbLid = '';

  try {
    const { rows } = await pool.query(
      "SELECT key, value FROM settings WHERE key IN ('whitelist_jid', 'whitelist_lid')"
    );
    for (const r of rows) {
      if (r.key === 'whitelist_jid') {
        dbJid = typeof r.value === 'string' ? r.value : JSON.parse(r.value || '""');
      }
      if (r.key === 'whitelist_lid') {
        dbLid = typeof r.value === 'string' ? r.value : JSON.parse(r.value || '""');
      }
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Gagal membaca settings whitelist dari database, menggunakan fallback .env');
  }

  const whitelistJid = normalizeJid(dbJid || env.WHITELIST_JID || '');
  const whitelistLid = normalizeJid(dbLid || env.WHITELIST_LID || '');

  cachedWhitelist = { whitelistJid, whitelistLid };
  lastCacheTime = now;
  return cachedWhitelist;
}

/**
 * Cek apakah JID pengirim cocok dengan nomor pemilik yang terdaftar di whitelist.
 * @param {string} jid
 * @returns {Promise<boolean>}
 */
export async function isAllowed(jid) {
  if (!jid) return false;
  const normalized = normalizeJid(jid);
  const { whitelistJid, whitelistLid } = await getWhitelistConfig();

  if (whitelistJid && normalized === whitelistJid) return true;
  if (whitelistLid && normalized === whitelistLid) return true;

  return false;
}

/**
 * Mencatat pesan yang dibuang ke database (tanpa isi pesan demi privasi).
 * @param {string} reason
 */
export async function recordDroppedMessage(reason = 'unauthorized_jid') {
  incrementDroppedCount();
  try {
    await pool.query('INSERT INTO bot_events (type, detail) VALUES ($1, $2)', [
      'dropped_message',
      reason,
    ]);
  } catch (err) {
    logger.warn({ err: err.message }, 'Gagal mencatat dropped_message ke database');
  }
}
