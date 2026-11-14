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
import { understandMessage } from '../ai/understand.js';
import { executeTool } from '../tools/index.js';
import { getActivePendingAction, resolvePendingAction } from '../services/pendingActions.js';
import { addChatMessage } from '../services/chatHistory.js';
import { ensurePreviousPeriodsClosed } from '../services/rollover.js';
import { nowWib } from '../utils/time.js';
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
 * Router utama penanganan pesan Baileys (Pipeline Fase 2).
 * Spesifikasi: 00-konteks-aplikasi.md Bagian 9 & 02-fase2-keuangan-inti.md
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
export async function processSingleMessage(msg) {
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
    const { text, hasMedia, quotedStanzaId } = extractContent(msg);

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

    // Lazy Closure: Pastikan tidak ada periode masa lalu yang belum ditutup
    try {
      const dt = nowWib();
      await ensurePreviousPeriodsClosed(dt.year, dt.month);
    } catch (err) {
      logger.warn({ err: err.message }, 'Gagal menjalankan lazy closure periode');
    }

    // 6. Cek pending_actions (konfirmasi ya / tidak)
    if (text) {
      const lower = text.trim().toLowerCase();
      if (lower === 'ya' || lower === 'y' || lower === 'ok' || lower === 'lanjut') {
        const active = await getActivePendingAction();
        if (active) {
          await resolvePendingAction(active.id, 'confirmed');
          const payload = typeof active.payload === 'string' ? JSON.parse(active.payload) : active.payload;

          const execResult = await executeTool(payload.action, {
            ...payload.context,
            skipConfirmation: true,
            waMessageId: key.id,
          });

          const replyIds = await sendText(rawRemoteJid, execResult.reply);
          const botReplyId = replyIds?.[0] || null;
          if (botReplyId && execResult.data?.id) {
            if (payload.action.tool === 'add_transaction') {
              await pool.query('UPDATE transactions SET bot_reply_id = $1 WHERE id = $2', [botReplyId, execResult.data.id]);
              await pool.query("UPDATE action_log SET bot_reply_id = $1 WHERE entity = 'transaction' AND entity_id = $2", [botReplyId, execResult.data.id]);
            } else if (payload.action.tool === 'transfer_between_pockets') {
              await pool.query('UPDATE pocket_transfers SET bot_reply_id = $1 WHERE id = $2', [botReplyId, execResult.data.id]);
              await pool.query("UPDATE action_log SET bot_reply_id = $1 WHERE entity = 'transfer' AND entity_id = $2", [botReplyId, execResult.data.id]);
            }
          }

          await addChatMessage('user', text);
          await addChatMessage('assistant', execResult.reply);
          return;
        }
      } else if (lower === 'tidak' || lower === 'nggak' || lower === 'gak') {
        const active = await getActivePendingAction();
        if (active) {
          await resolvePendingAction(active.id, 'rejected');
          const cancelMsg = 'Aksi telah dibatalkan.';
          await sendText(rawRemoteJid, cancelMsg);
          await addChatMessage('user', text);
          await addChatMessage('assistant', cancelMsg);
          return;
        }
      }
    }

    // 7. Regex fast-path commands (ping, bantuan, saldo, kantong, batal, ralat, reset)
    if (text) {
      const regexReply = await handleRegexCommand(text, { quotedStanzaId });
      if (regexReply) {
        await sendText(rawRemoteJid, regexReply);
        await addChatMessage('user', text);
        await addChatMessage('assistant', regexReply);
        return;
      }
    }

    // 8. Media tanpa teks (Fase 6 Vision)
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

    // 10. Agentic AI (Fase 2: Understand -> Validate -> Execute -> Respond)
    logger.info('Meneruskan pesan ke AI Agent (Understand)...');
    const understood = await understandMessage(text);
    logger.info({ intent: understood.intent, actionsCount: understood.actions?.length }, 'Hasil pemahaman AI');

    // Catat pesan pengguna ke memori riwayat chat
    await addChatMessage('user', text);

    // Kasus 1: Obrolan santai biasa tanpa aksi keuangan
    if (understood.intent === 'chat_biasa' || (understood.actions.length === 0 && !understood.clarification)) {
      const aiReply = await replyChat(text);
      await sendText(rawRemoteJid, aiReply);
      await addChatMessage('assistant', aiReply);
      return;
    }

    // Kasus 2: Pesan ambigu memerlukan klarifikasi
    if (understood.intent === 'klarifikasi') {
      const clarifyMsg = understood.clarification || 'Bisa tolong jelaskan kembali atau diperinci maksud pesanmu?';
      await sendText(rawRemoteJid, clarifyMsg);
      await addChatMessage('assistant', clarifyMsg);
      return;
    }

    // Kasus 3: Menjalankan daftar aksi keuangan
    const replies = [];
    const executedResults = [];

    for (const action of understood.actions) {
      const res = await executeTool(action, {
        messageText: text,
        confidence: understood.confidence,
        waMessageId: key.id,
      });

      replies.push(res.reply);
      executedResults.push({ action, res });

      // Jika salah satu aksi masuk ke pending (butuh konfirmasi), stop aksi berikutnya
      if (res.status === 'pending') {
        break;
      }
    }

    const combinedReply = replies.join('\n\n---\n\n');
    const replyIds = await sendText(rawRemoteJid, combinedReply);
    const botReplyId = replyIds?.[0] || null;

    if (botReplyId) {
      for (const item of executedResults) {
        const entityId = item.res.data?.id || item.res.data?.transaction?.id;
        if (entityId) {
          if (item.action.tool === 'add_transaction' || item.action.tool === 'set_monthly_income') {
            await pool.query('UPDATE transactions SET bot_reply_id = $1 WHERE id = $2', [botReplyId, entityId]);
            await pool.query("UPDATE action_log SET bot_reply_id = $1 WHERE entity = 'transaction' AND entity_id = $2", [botReplyId, entityId]);
          } else if (item.action.tool === 'transfer_between_pockets') {
            await pool.query('UPDATE pocket_transfers SET bot_reply_id = $1 WHERE id = $2', [botReplyId, entityId]);
            await pool.query("UPDATE action_log SET bot_reply_id = $1 WHERE entity = 'transfer' AND entity_id = $2", [botReplyId, entityId]);
          }
        }
      }
    }

    await addChatMessage('assistant', combinedReply);
  } catch (err) {
    logger.error({ err: err.message, stack: err.stack }, 'Terjadi kesalahan saat memproses pesan');
    try {
      if (msg.key?.remoteJid) {
        await sendText(msg.key.remoteJid, 'Maaf, ada gangguan teknis. Coba lagi sebentar ya.');
      }
    } catch {}
  }
}

export default handleMessagesUpsert;
