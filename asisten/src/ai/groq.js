import env from '../config/env.js';
import { pool } from '../db/pool.js';
import { logger } from '../utils/logger.js';
import { CONSTANTS } from '../config/constants.js';

// Sliding window rate limiter untuk Groq API
const requestTimestamps = [];

/**
 * Tunggu slot rate limit tersedia sesuai GROQ_RPM_LIMIT (Token bucket sliding-window).
 */
async function waitForRateLimitSlot() {
  const limit = env.GROQ_RPM_LIMIT || CONSTANTS.GROQ_DEFAULT_RPM_LIMIT;
  const now = Date.now();

  // Bersihkan timestamp yang lebih dari 60 detik lalu
  while (requestTimestamps.length > 0 && now - requestTimestamps[0] >= 60000) {
    requestTimestamps.shift();
  }

  if (requestTimestamps.length >= limit) {
    const oldest = requestTimestamps[0];
    const waitTime = 60000 - (now - oldest);
    if (waitTime > CONSTANTS.GROQ_RATE_LIMIT_WAIT_MS) {
      throw new Error('RATE_LIMITED: Batas panggilan Groq per menit tercapai.');
    }
    logger.debug({ waitTimeMs: waitTime }, 'Menunggu slot rate limit Groq...');
    await new Promise((resolve) => setTimeout(resolve, waitTime));
    return waitForRateLimitSlot();
  }

  requestTimestamps.push(Date.now());
}

/**
 * Mencatat penggunaan token dan latensi AI ke database (tabel ai_usage_log).
 */
async function logAiUsage({ model, purpose, tokensIn, tokensOut, latencyMs, ok, error }) {
  try {
    await pool.query(
      `INSERT INTO ai_usage_log (model, purpose, tokens_in, tokens_out, latency_ms, ok, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [model, purpose, tokensIn, tokensOut, latencyMs, ok, error]
    );
  } catch (err) {
    logger.warn({ err: err.message }, 'Gagal mencatat ai_usage_log');
  }
}

/**
 * Membersihkan output teks dari blok <think>...</think> jika dihasilkan model penalaran.
 * @param {string} text
 * @returns {string}
 */
export function cleanAiOutput(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/**
 * Panggilan OpenAI-compatible Chat Completion ke Groq API.
 * Menggunakan fetch bawaan Node.js, rate limiting, retry otomatis, dan logging.
 *
 * @param {object} params
 * @param {Array<{ role: string, content: string }>} params.messages
 * @param {number} [params.temperature=0.7]
 * @param {number} [params.maxTokens=400]
 * @param {string} [params.purpose='chat']
 * @param {string} [params.model]
 * @returns {Promise<string>}
 */
export async function chatCompletion({
  messages,
  temperature = 0.7,
  maxTokens = 400,
  purpose = 'chat',
  model = env.GROQ_TEXT_MODEL,
  responseFormat = null,
}) {
  await waitForRateLimitSlot();

  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY belum dikonfigurasi di .env');
  }

  const payload = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  if (responseFormat) {
    payload.response_format = responseFormat;
  }

  const startTime = Date.now();
  let attempt = 0;
  const maxAttempts = 2; // 1 kali panggilan + 1 retry

  while (attempt < maxAttempts) {
    attempt++;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONSTANTS.GROQ_TIMEOUT_MS);

    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      // Handle rate limit 429 atau 5xx
      if (!res.ok) {
        const errorBody = await res.text();
        const retryAfterHeader = res.headers.get('retry-after');

        if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
          const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 2;
          logger.warn(
            { status: res.status, attempt, retryAfterSec },
            'Groq API mengembalikan error transient, mencoba ulang...'
          );
          await new Promise((r) => setTimeout(r, Math.max(1000, retryAfterSec * 1000)));
          continue;
        }

        const latencyMs = Date.now() - startTime;
        await logAiUsage({
          model,
          purpose,
          tokensIn: null,
          tokensOut: null,
          latencyMs,
          ok: false,
          error: `HTTP ${res.status}: ${errorBody.slice(0, 200)}`,
        });

        throw new Error(`Groq API error HTTP ${res.status}: ${errorBody}`);
      }

      const data = await res.json();
      const latencyMs = Date.now() - startTime;
      const rawContent = data.choices?.[0]?.message?.content || '';
      const cleaned = cleanAiOutput(rawContent);

      const tokensIn = data.usage?.prompt_tokens || null;
      const tokensOut = data.usage?.completion_tokens || null;

      await logAiUsage({
        model,
        purpose,
        tokensIn,
        tokensOut,
        latencyMs,
        ok: true,
        error: null,
      });

      return cleaned;
    } catch (err) {
      clearTimeout(timeout);
      if (attempt < maxAttempts && (err.name === 'AbortError' || err.code === 'ECONNRESET')) {
        logger.warn({ err: err.message, attempt }, 'Koneksi ke Groq terputus/timeout, mencoba ulang...');
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }

      const latencyMs = Date.now() - startTime;
      await logAiUsage({
        model,
        purpose,
        tokensIn: null,
        tokensOut: null,
        latencyMs,
        ok: false,
        error: err.message,
      });

      throw err;
    }
  }

  throw new Error('Gagal menghubungi Groq API setelah retry.');
}

export default chatCompletion;
