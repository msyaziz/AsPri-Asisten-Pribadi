import PQueue from 'p-queue';
import env from '../config/env.js';
import { pool } from '../db/pool.js';
import { logger } from '../utils/logger.js';
import { normalizeJid, isGroup } from '../utils/jid.js';
import { isAllowed, recordDroppedMessage } from './whitelist.js';
import { extractContent } from './extract.js';
import { sendText } from './sender.js';
import { handleRegexCommand } from './regexCommands.js';
import { isSensitive, SENSITIVE_WARNING_MESSAGE } from '../ai/sensitiveFilter.js';
import { replyChat } from '../ai/chat.js';
import { CONSTANTS } from '../config/constants.js';

// Antrean serial untuk seluruh pemrosesan pesan (concurrency: 1) demi stabilitas RAM & urutan pesan
const messageProcessingQueue = new PQueue({ concurrency: 1 });

// Rate limit lokal (30 pesan / menit)
const userMessageTimestamps = [];
let lastRateLimitWarningTime = 0;

function checkLocalRateLimit() {
  const now = Date.now();
  while (userMessageTimestamps.length > 0 && now - userMessageTimestamps[0] >= 60000) {
    userMessageTimestamps.shift();
  }

  if (userMessageTimestamps.length >= CONSTANTS.RATE_LIMIT_WA_PER_MINUTE) {
    const shouldWarn = now - lastRateLimitWarningTime > 60000;
    if (shouldWarn) {
      lastRateLimitWarningTime = now;
      return 'warn';
    }
    return 'drop';
  }

  userMessageTimestamps.push(now);
  return 'ok';
}

/**
 * Memeriksa apakah ID pesan sudah pernah diproses sebelumnya (dedupe).
 * @param {string} messageId
 * @returns {Promise<boolean>} True jika pesan baru, false jika duplikat
 */
async function deduplicateMessage(messageId) {
  if (!messageId) return true;
  try {
    const res = await pool.query(
      `INSERT INTO processed_messages (message_id)
       VALUES ($1)
       ON CONFLICT (message_id) DO NOTHING
       RETURNING message_id`,
      [messageId]
    );
    return res.rowCount > 0;
  } catch (err) {
    logger.warn({ err: err.message }, 'Gagal memeriksa deduplikasi pesan');
    return true;
  }
}

/**
 * Router utama penanganan pesan Baileys (Pipeline Fase 1).
 * Spesifikasi: docs/01-fase1-bot-dasar.md bagian 8.7
 *
 * @param {any} upsert Objek messages.upsert dari Baileys
 */
export async function handleMessagesUpsert(upsert) {
  // Hanya proses event tipe 'notify'
  if (upsert.type !== 'notify' || !Array.isArray(upsert.messages)) {
    return;
  }

  for (const msg of upsert.messages) {
    messageProcessingQueue.add(() => processSingleMessage(msg));
  }
}

/**
 * Pipeline pemrosesan satu pesan WhatsApp.
 * @param {any} msg
 */
async function processSingleMessage(msg) {
  try {
    const key = msg.key;
    if (!key) return;

    // 1. Filter dasar: fromMe, grup (@g.us), status broadcast, newsletter
    if (key.fromMe) return;

    const rawRemoteJid = key.remoteJid || '';
    if (
      !rawRemoteJid ||
      isGroup(rawRemoteJid) ||
      rawRemoteJid === 'status@broadcast' ||
      rawRemoteJid.endsWith('@newsletter')
    ) {
      return;
    }

    const senderJid = normalizeJid(rawRemoteJid);
    const participantJid = key.participant ? normalizeJid(key.participant) : null;

    // 2. Mode Pairing vs Whitelist Gate
    if (env.PAIRING_MODE) {
      console.log('\n======================================================');
      console.log('🔔 [MODE PAIRING] Pesan masuk dari WhatsApp:');
      console.log(`   - remoteJid : "${rawRemoteJid}"`);
      console.log(`   - senderJid : "${senderJid}"`);
      if (participantJid) console.log(`   - participant : "${participantJid}"`);
      console.log(`   - pushName  : "${msg.pushName || 'tidak ada'}"`);
      console.log('💡 Salin JID ini ke WHITELIST_JID di file .env lalu ubah PAIRING_MODE=false.');
      console.log('======================================================\n');
      return; // Dalam mode pairing, bot tidak membalas apa pun
    }

    // Periksa apakah sender JID terdaftar di whitelist
    const allowed = (await isAllowed(senderJid)) || (participantJid && (await isAllowed(participantJid)));
    if (!allowed) {
      logger.info({ senderJid }, 'Pesan dari nomor non-whitelist diabaikan diam-diam.');
      await recordDroppedMessage('unauthorized_jid');
      return;
    }

    // 3. Deduplikasi pesan (processed_messages)
    const isNew = await deduplicateMessage(key.id);
    if (!isNew) {
      logger.debug({ messageId: key.id }, 'Pesan duplikat diabaikan.');
      return;
    }

    // 4. Ekstraksi konten pesan
    const { text, hasMedia } = extractContent(msg);

    // 5. Rate limit lokal (30 pesan/menit)
    const rateStatus = checkLocalRateLimit();
    if (rateStatus === 'drop') {
      logger.warn('Rate limit lokal terlampaui, pesan diabaikan.');
      return;
    }
    if (rateStatus === 'warn') {
      await sendText(rawRemoteJid, 'Pelan-pelan ya 🙏');
      return;
    }

    // 6. (Placeholder pending_actions: Fase 2)

    // 7. Regex fast-path commands (ping, bantuan, menu, reset)
    if (text) {
      const regexReply = await handleRegexCommand(text);
      if (regexReply) {
        await sendText(rawRemoteJid, regexReply);
        return;
      }
    }

    // 8. Media tanpa teks
    if (hasMedia && !text) {
      await sendText(rawRemoteJid, 'Fitur gambar belum aktif.');
      return;
    }

    // Jika pesan kosong (mis. protokol/sticker tanpa teks)
    if (!text) {
      return;
    }

    // 9. Sensitive filter check
    if (isSensitive(text)) {
      logger.info('Pesan mengandung kata sensitif, menolak memproses ke Groq.');
      await sendText(rawRemoteJid, SENSITIVE_WARNING_MESSAGE);
      return;
    }

    // Panggil AI Groq untuk merespons percakapan santai
    logger.info('Meneruskan pesan santai ke AI Agent (Groq)...');
    const aiReply = await replyChat(text);
    await sendText(rawRemoteJid, aiReply);
  } catch (err) {
    logger.error({ err: err.message }, 'Terjadi kesalahan saat memproses pesan');
    try {
      if (msg.key?.remoteJid) {
        await sendText(msg.key.remoteJid, 'Maaf, ada gangguan. Coba lagi sebentar ya.');
      }
    } catch {}
  }
}

export default handleMessagesUpsert;
