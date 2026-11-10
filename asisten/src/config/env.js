import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
    PORT: z.coerce.number().default(3000),
    HOST: z.string().default('127.0.0.1'),
    TZ: z.string().default('Asia/Jakarta'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL wajib diisi di .env'),

    PAIRING_MODE: z
      .preprocess((val) => {
        if (typeof val === 'string') return val.toLowerCase() === 'true';
        return Boolean(val);
      }, z.boolean())
      .default(false),

    WHITELIST_JID: z.string().optional().default(''),
    WHITELIST_LID: z.string().optional().default(''),
    BOT_PHONE_NUMBER: z.string().optional().default(''),

    GROQ_API_KEY: z.string().optional().default(''),
    GROQ_TEXT_MODEL: z.string().optional().default(''),
    GROQ_VISION_MODEL: z.string().optional().default(''),
    GROQ_RPM_LIMIT: z.coerce.number().default(20),

    DATA_DIR: z.string().default('./data'),
  })
  .superRefine((data, ctx) => {
    const isMigration =
      process.env.MIGRATION_MODE === '1' ||
      process.argv.some((arg) => arg.includes('migrate'));

    // Bila bukan pairing mode, WHITELIST_JID wajib ada
    if (!data.PAIRING_MODE && !data.WHITELIST_JID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WHITELIST_JID'],
        message: 'WHITELIST_JID wajib diisi ketika PAIRING_MODE=false.',
      });
    }

    // Bila bukan dalam mode migrasi mandiri, GROQ_API_KEY dan GROQ_TEXT_MODEL wajib ada
    if (!isMigration) {
      if (!data.GROQ_API_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['GROQ_API_KEY'],
          message: 'GROQ_API_KEY wajib diisi di .env untuk menjalankan bot.',
        });
      }
      if (!data.GROQ_TEXT_MODEL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['GROQ_TEXT_MODEL'],
          message: 'GROQ_TEXT_MODEL wajib diisi di .env.',
        });
      }
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('\n❌ [FATAL] Kesalahan konfigurasi environment (.env):');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('Silakan periksa file .env Anda.\n');
  process.exit(1);
}

export const env = parsed.data;
export default env;
