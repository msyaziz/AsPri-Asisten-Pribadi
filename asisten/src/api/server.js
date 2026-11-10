import express from 'express';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import env from '../config/env.js';
import { logger } from '../utils/logger.js';
import healthRouter from './routes/health.js';
import botRouter from './routes/bot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../../public');

export function createServer() {
  const app = express();

  // Reverse proxy support
  app.set('trust proxy', 1);

  // Security headers
  app.use(
    helmet({
      contentSecurityPolicy: false, // Memudahkan CDN Tailwind/Chart.js pada frontend nantinya
    })
  );

  // Body parser dengan batas 100kb
  app.use(express.json({ limit: '100kb' }));

  // Sajikan berkas statis dari public/
  app.use(express.static(publicDir));

  // Route API
  app.use('/api/health', healthRouter);
  app.use('/api/bot', botRouter);

  // 404 handler API
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Endpoint tidak ditemukan' });
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
