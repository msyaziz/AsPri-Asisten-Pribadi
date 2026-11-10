import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { getStatus as getBotStatus } from '../../bot/connection.js';

export const healthRouter = Router();

healthRouter.get('/', async (req, res) => {
  let dbOk = false;
  try {
    await pool.query('SELECT 1');
    dbOk = true;
  } catch {
    dbOk = false;
  }

  let botState = 'unknown';
  try {
    const status = getBotStatus();
    botState = status?.state || 'unknown';
  } catch {
    botState = 'error';
  }

  const ok = dbOk && botState !== 'logged_out';

  res.status(ok ? 200 : 503).json({
    ok,
    db: dbOk,
    bot: botState,
    uptime: Math.floor(process.uptime()),
    version: '0.1.0',
  });
});

export default healthRouter;
