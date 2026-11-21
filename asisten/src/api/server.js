import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import env from '../config/env.js';
import { logger } from '../utils/logger.js';
import { requireAuth, verifyOrigin } from './middleware/auth.js';
import { createCloudflareAccessMiddleware } from './middleware/cloudflareAccess.js';
import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import botRouter from './routes/bot.js';
import summaryRouter from './routes/summary.js';
import periodsRouter from './routes/periods.js';
import pocketsRouter from './routes/pockets.js';
import transactionsRouter from './routes/transactions.js';
import transfersRouter from './routes/transfers.js';
import eventsRouter from './routes/events.js';
import notesRouter from './routes/notes.js';
import { categoriesRouter, categoryRulesRouter } from './routes/categories.js';
import { actionLogRouter, aiUsageRouter, pendingRouter } from './routes/logs.js';
import settingsRouter from './routes/settings.js';
import { reportsRouter, exportRouter } from './routes/reports.js';

if (!BigInt.prototype.toJSON) {
  BigInt.prototype.toJSON = function () {
    return Number(this);
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../../public');

export function createServer() {
  const app = express();

  // Reverse proxy support
  app.set('trust proxy', 1);

  // Security headers & CSP (izinkan CDN Tailwind & Chart.js)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            "'unsafe-inline'",
            'https://cdn.tailwindcss.com',
            'https://cdn.jsdelivr.net',
          ],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            'https://cdn.jsdelivr.net',
            'https://fonts.googleapis.com',
          ],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:'],
        },
      },
    })
  );

  // Body parser dengan batas 100kb
  app.use(express.json({ limit: '100kb' }));

  // Cookie parser
  app.use(cookieParser());

  // Sajikan berkas statis dari public/
  app.use(express.static(publicDir));

  // Global rate limit: 120 per menit per IP untuk rute API
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      ok: false,
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Batas permintaan tercapai (120/menit).',
      },
    },
  });
  app.use('/api', apiLimiter);

  // Proteksi CSRF (verifikasi Origin untuk metode ubah-data)
  app.use('/api', verifyOrigin);

  // Public API routes
  app.use('/api/health', healthRouter);

  // Hook Cloudflare Access (non-aktif secara default bila CF_ACCESS_ENABLED=false)
  app.use('/api', createCloudflareAccessMiddleware());

  app.use('/api/auth', authRouter);

  // Protected API routes
  app.use('/api/bot', requireAuth, botRouter);
  app.use('/api/summary', requireAuth, summaryRouter);
  app.use('/api/periods', requireAuth, periodsRouter);
  app.use('/api/pockets', requireAuth, pocketsRouter);
  app.use('/api/transactions', requireAuth, transactionsRouter);
  app.use('/api/transfers', requireAuth, transfersRouter);
  app.use('/api/events', requireAuth, eventsRouter);
  app.use('/api/notes', requireAuth, notesRouter);
  app.use('/api/categories', requireAuth, categoriesRouter);
  app.use('/api/category-rules', requireAuth, categoryRulesRouter);
  app.use('/api/action-log', requireAuth, actionLogRouter);
  app.use('/api/ai-usage', requireAuth, aiUsageRouter);
  app.use('/api/pending', requireAuth, pendingRouter);
  app.use('/api/settings', requireAuth, settingsRouter);
  app.use('/api/reports', requireAuth, reportsRouter);
  app.use('/api/export', requireAuth, exportRouter);

  // 404 handler API
  app.use('/api', (req, res) => {
    res.status(404).json({
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Endpoint tidak ditemukan',
      },
    });
  });

  return app;
}

/**
 * Menjalankan Express HTTP server.
 * @param {number} [port=env.PORT]
 * @param {string} [host=env.HOST]
 * @returns {Promise<import('http').Server>}
 */
export async function startServer(port = env.PORT, host = env.HOST) {
  const app = createServer();
  return new Promise((resolve) => {
    const server = app.listen(port, host, () => {
      logger.info({ host, port }, `Express server berjalan di http://${host}:${port}`);
      resolve(server);
    });
  });
}

/**
 * Menghentikan Express HTTP server secara graceful.
 * @param {import('http').Server} server
 * @returns {Promise<void>}
 */
export async function stopServer(server) {
  if (!server) return;
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

export default createServer;
