import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { chatCompletion } from './groq.js';
import { getRecentHistory, addChatMessage } from '../services/chatHistory.js';
import { getSystemTimeContext } from '../utils/time.js';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const personaPath = path.resolve(__dirname, 'prompts/persona.md');

let cachedPersona = null;

async function getPersonaPrompt() {
  if (!cachedPersona) {
    try {
      cachedPersona = await fs.readFile(personaPath, 'utf-8');
    } catch (err) {
      logger.error({ err: err.message }, 'Gagal membaca persona.md, menggunakan fallback persona');
      cachedPersona =
        'Kamu adalah asisten pribadi berbahasa Indonesia yang santai, akrab, dan ringkas.';
    }
  }
  return cachedPersona;
}

/**
 * Menghasilkan balasan chat santai AI dengan menyertakan konteks waktu dan 10 riwayat percakapan terakhir.
 * Spesifikasi: docs/01-fase1-bot-dasar.md bagian 8.11
 *
 * @param {string} userText
 * @returns {Promise<string>}
 */
export async function replyChat(userText) {
  try {
    const persona = await getPersonaPrompt();
    const timeContext = getSystemTimeContext();
    const systemContent = `${persona.trim()}\n\nKonteks waktu saat ini: ${timeContext}`;

    const recentHistory = await getRecentHistory(10);

    const messages = [
      { role: 'system', content: systemContent },
      ...recentHistory.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: userText },
    ];

    const aiReply = await chatCompletion({
      messages,
      temperature: 0.7,
      maxTokens: 400,
      purpose: 'chat',
    });

    if (!aiReply) {
      throw new Error('Respons AI kosong');
    }

    // Simpan interaksi ke riwayat percakapan HANYA jika panggilan Groq berhasil
    await addChatMessage('user', userText);
    await addChatMessage('assistant', aiReply);

    return aiReply;
  } catch (err) {
    logger.error({ err: err.message }, 'Gagal memproses replyChat via Groq');
    return 'Maaf, AI lagi bermasalah. Coba lagi sebentar ya.';
  }
}

export default replyChat;
