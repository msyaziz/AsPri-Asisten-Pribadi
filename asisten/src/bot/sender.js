import PQueue from 'p-queue';
import { getSocket } from './connection.js';
import { isAllowed } from './whitelist.js';
import { logger } from '../utils/logger.js';
import { CONSTANTS } from '../config/constants.js';

// Antrean serial untuk pengiriman pesan WhatsApp (concurrency: 1)
const sendQueue = new PQueue({ concurrency: 1 });

/**
 * Memecah teks panjang menjadi beberapa bagian <= maxLen tanpa memotong kata sembarangan.
 * @param {string} text
 * @param {number} [maxLen=CONSTANTS.MAX_MESSAGE_LENGTH]
 * @returns {string[]}
 */
export function splitMessage(text, maxLen = CONSTANTS.MAX_MESSAGE_LENGTH) {
  if (!text || text.length <= maxLen) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    let splitIdx = remaining.lastIndexOf('\n', maxLen);
    if (splitIdx === -1 || splitIdx < maxLen * 0.5) {
      splitIdx = remaining.lastIndexOf(' ', maxLen);
    }
    if (splitIdx === -1) {
      splitIdx = maxLen;
    }

    chunks.push(remaining.slice(0, splitIdx).trim());
    remaining = remaining.slice(splitIdx).trim();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

/**
 * Mengirim pesan teks ke WhatsApp dengan antrean serial, jeda manusiawi, dan verifikasi whitelist.
 *
 * @param {string} jid WhatsApp JID tujuan
 * @param {string} text Teks yang akan dikirim
 * @param {object} [options={}] Opsi tambahan Baileys (mis. quoted)
 * @returns {Promise<string[]>} Array ID pesan yang terkirim
 */
export async function sendText(jid, text, options = {}) {
  // Pagar Ganda: Tolak jika nomor tujuan bukan whitelist
  const allowed = await isAllowed(jid);
  if (!allowed) {
    logger.error({ jid }, 'Pengiriman pesan DITOLAK: JID bukan nomor whitelist (pagar ganda)');
    throw new Error(`Pagar ganda: JID ${jid} tidak terdaftar di whitelist.`);
  }

  const chunks = splitMessage(text);
  const sentMessageIds = [];

  for (const chunk of chunks) {
    const messageId = await sendQueue.add(async () => {
      const sock = getSocket();
      if (!sock) {
        throw new Error('Gagal mengirim pesan: Socket Baileys belum terhubung.');
      }

      // 1. Tampilkan status sedang mengetik (composing)
      try {
        await sock.sendPresenceUpdate('composing', jid);
      } catch (err) {
        logger.debug({ err: err.message }, 'Gagal mengirim presence composing');
      }

      // 2. Jeda acak 1 sampai 3 detik
      const delayMs =
        Math.floor(
          Math.random() * (CONSTANTS.SEND_DELAY_MAX_MS - CONSTANTS.SEND_DELAY_MIN_MS + 1)
        ) + CONSTANTS.SEND_DELAY_MIN_MS;
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      // 3. Kirim pesan
      const res = await sock.sendMessage(jid, { text: chunk }, options);

      // 4. Ubah status presence ke paused
      try {
        await sock.sendPresenceUpdate('paused', jid);
      } catch (err) {
        logger.debug({ err: err.message }, 'Gagal mengirim presence paused');
      }

      return res?.key?.id || null;
    });

    if (messageId) {
      sentMessageIds.push(messageId);
    }
  }

  return sentMessageIds;
}

export default sendText;
