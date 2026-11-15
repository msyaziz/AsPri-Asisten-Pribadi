import { describe, it, expect, vi, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { understandMessage } from '../src/ai/understand.js';
import { pool } from '../src/db/pool.js';
import { logger } from '../src/utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Kasus yang ditangani Lapis 1 (tanpa Groq) — cocok rule, sapaan, tanya data deterministik, anti-injection */
const LAYER1_IDS = new Set([
  1, 2, 5, 8, 9, 31, 32, 33, 34, 35, 36, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50
]);

/** Delay antar panggilan Groq untuk hindari rate-limit */
const DELAY_MS = 400;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Jalankan understandMessage dengan retry jika terjadi error rate-limit transient.
 * Groq.js sudah handle 429 sampai 5x, tapi jika melampaui itu, test akan retry sekali lagi
 * setelah menunggu lebih lama.
 */
async function understandWithRetry(message, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await understandMessage(message);
    } catch (err) {
      const isRateLimit =
        err.message?.includes('429') ||
        err.message?.includes('rate') ||
        err.message?.includes('RATE_LIMITED');

      if (isRateLimit && attempt < maxRetries) {
        const wait = 30_000 * attempt; // 30s, 60s
        logger.warn({ attempt, wait }, `Rate-limit saat test, menunggu ${wait / 1000}s sebelum retry...`);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
}

describe('Fase 3 - Kontrak AI 50 Kalimat (Checkpoint D)', () => {
  // 10 menit — cukup untuk 50 panggilan dengan delay + retry Groq
  vi.setConfig({ testTimeout: 600_000 });

  const casesFilePath = path.join(__dirname, 'ai-cases.json');
  const testCases = JSON.parse(fs.readFileSync(casesFilePath, 'utf-8'));

  afterAll(async () => {
    await pool.end();
  });

  it('jumlah kasus tepat 50', () => {
    expect(testCases.length).toBe(50);
  });

  it('memenuhi kontrak pemahaman ≥ 90% kasus uji (50 kalimat)', async () => {
    let passedCount = 0;
    const failures = [];
    let groqCallCount = 0;

    for (const testCase of testCases) {
      const isLayer1 = LAYER1_IDS.has(testCase.id);

      // Tambah delay SEBELUM panggilan ke Groq (tidak untuk kasus Lapis 1)
      if (!isLayer1) {
        if (groqCallCount > 0) await sleep(DELAY_MS);
        groqCallCount++;
      }

      try {
        const result = await understandWithRetry(testCase.message);

        // --- Kriteria Keberhasilan ---

        // 1. Intent cocok
        let isIntentMatch = result.intent === testCase.expectedIntent;
        // Toleransi: chat_biasa ↔ klarifikasi sama-sama OK untuk kasus ambigu/injection
        if (
          !isIntentMatch &&
          (testCase.expectedIntent === 'chat_biasa' || testCase.expectedIntent === 'klarifikasi')
        ) {
          isIntentMatch = result.intent === 'chat_biasa' || result.intent === 'klarifikasi';
        }

        // 2. Tool yang diharapkan ada di dalam actions
        let isToolMatch = true;
        if (testCase.expectedTool) {
          isToolMatch = result.actions.some((a) => a.tool === testCase.expectedTool);
        }

        // 3. Jumlah minimal aksi terpenuhi
        let isMinActionsMatch = true;
        if (testCase.minActions !== undefined) {
          isMinActionsMatch = result.actions.length >= testCase.minActions;
        }

        // 4. Nominal yang diharapkan cocok
        let isAmountMatch = true;
        if (testCase.expectedAmount) {
          isAmountMatch = result.actions.some((a) => a.args?.amount === testCase.expectedAmount);
        }

        // 5. Injection tidak boleh menghasilkan aksi tool apa pun (ID 50)
        let isSafe = true;
        if (testCase.id === 50 && result.actions.length > 0) {
          isSafe = false;
        }

        const passed =
          isIntentMatch && isToolMatch && isMinActionsMatch && isAmountMatch && isSafe;

        if (passed) {
          passedCount++;
          logger.debug({ id: testCase.id, msg: testCase.message }, '✅ LULUS');
        } else {
          failures.push({
            id: testCase.id,
            message: testCase.message,
            expected: {
              intent: testCase.expectedIntent,
              tool: testCase.expectedTool,
              amount: testCase.expectedAmount,
              minActions: testCase.minActions,
            },
            actual: {
              intent: result.intent,
              actions: result.actions,
              clarification: result.clarification,
            },
            checks: { isIntentMatch, isToolMatch, isMinActionsMatch, isAmountMatch, isSafe },
          });
          logger.warn({ id: testCase.id, msg: testCase.message }, '❌ GAGAL');
        }
      } catch (err) {
        failures.push({
          id: testCase.id,
          message: testCase.message,
          error: err.message,
        });
        logger.error({ id: testCase.id, err: err.message }, '💥 ERROR');
      }
    }

    const passRate = (passedCount / testCases.length) * 100;
    logger.info(
      {
        passed: passedCount,
        total: testCases.length,
        passRate: `${passRate.toFixed(1)}%`,
        groqCalls: groqCallCount,
      },
      'Hasil Pengujian Kontrak AI 50 Kalimat'
    );

    if (failures.length > 0) {
      console.log('\n=== Kasus yang belum cocok ===');
      console.log(JSON.stringify(failures, null, 2));
    }

    console.log(
      `\n📊 Pass rate: ${passedCount}/${testCases.length} = ${passRate.toFixed(1)}% (target ≥ 90%)`
    );

    // TARGET PRD §5: ≥ 90% kasus uji AI lolos
    expect(passRate).toBeGreaterThanOrEqual(90);
  });
});
