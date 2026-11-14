import env from './config/env.js';
import { logger } from './utils/logger.js';
import { pool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { startServer, stopServer } from './api/server.js';
import { startBot, stopBot, registerMessageHandler } from './bot/connection.js';
import { handleMessagesUpsert } from './bot/router.js';
import { initJobs, stopJobs } from './jobs/index.js';

logger.info(
  {
    nodeEnv: env.NODE_ENV,
    tz: env.TZ,
    port: env.PORT,
    host: env.HOST,
    pairingMode: env.PAIRING_MODE,
  },
  'Memulai aplikasi Asisten Pribadi...'
);

let server = null;

async function bootstrap() {
  try {
    // 1. Cek koneksi database PostgreSQL
    logger.info('Memeriksa koneksi database PostgreSQL...');
    await pool.query('SELECT 1');
    logger.info('Koneksi database PostgreSQL terverifikasi.');

    // 2. Jalankan migrasi database
    logger.info('Memeriksa migrasi database...');
    const executed = await runMigrations();
    if (executed.length > 0) {
      logger.info({ executed }, `Berhasil menjalankan ${executed.length} migrasi baru.`);
    } else {
      logger.info('Semua migrasi sudah up to date.');
    }

    // 3. Jalankan HTTP server Express
    server = await startServer(env.PORT, env.HOST);

    // 4. Inisialisasi scheduler cron jobs
    initJobs();

    // 5. Inisialisasi bot WhatsApp
    registerMessageHandler(handleMessagesUpsert);
    await startBot();
  } catch (err) {
    logger.fatal({ err: err.message, stack: err.stack }, 'Gagal melakukan bootstrap aplikasi.');
    await cleanup();
    process.exit(1);
  }
}

let isCleaningUp = false;
async function cleanup(signal = '') {
  if (isCleaningUp) return;
  isCleaningUp = true;
  logger.info({ signal }, 'Menghentikan proses aplikasi secara graceful...');

  try {
    stopJobs();
  } catch (err) {
    logger.error({ err: err.message }, 'Gagal menghentikan cron jobs');
  }

  try {
    await stopBot();
  } catch (err) {
    logger.error({ err: err.message }, 'Gagal menghentikan bot');
  }

  try {
    if (server) await stopServer(server);
  } catch (err) {
    logger.error({ err: err.message }, 'Gagal menghentikan Express server');
  }

  try {
    await pool.end();
  } catch (err) {
    logger.error({ err: err.message }, 'Gagal menutup pool database');
  }

  logger.info('Shutdown selesai.');
}

process.on('SIGTERM', () => cleanup('SIGTERM').then(() => process.exit(0)));
process.on('SIGINT', () => cleanup('SIGINT').then(() => process.exit(0)));

process.on('uncaughtException', (err) => {
  logger.fatal({ err: err.message, stack: err.stack }, 'Uncaught Exception!');
  cleanup('uncaughtException').finally(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled Rejection terdeteksi!');
});

bootstrap();
