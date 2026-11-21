import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { expirePendingActions } from '../../services/pendingActions.js';

export const actionLogRouter = Router();
export const aiUsageRouter = Router();
export const pendingRouter = Router();

// GET /api/action-log
actionLogRouter.get('/', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const entity = req.query.entity;
    const values = [];
    let where = '';

    if (entity) {
      values.push(entity);
      where = 'WHERE entity = $1';
    }
    values.push(limit);

    const result = await pool.query(
      `SELECT id, entity, entity_id, action, before_data, after_data, bot_reply_id, created_at
       FROM action_log
       ${where}
       ORDER BY created_at DESC
       LIMIT $${values.length}`,
      values
    );

    res.json({ ok: true, data: result.rows });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: { code: 'GET_ACTION_LOG_FAILED', message: err.message },
    });
  }
});

// GET /api/ai-usage
aiUsageRouter.get('/', async (req, res) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);

    // Ambil log penggunaan
    const logs = await pool.query(
      `SELECT id, model, purpose, tokens_in, tokens_out, latency_ms, ok, error, created_at
       FROM ai_usage_log
       WHERE created_at >= now() - ($1 || ' days')::interval
       ORDER BY created_at DESC
       LIMIT $2`,
      [days, limit]
    );

    // Ambil ringkasan agregat
    const summary = await pool.query(
      `SELECT
         COUNT(*)::int AS total_requests,
         COALESCE(SUM(tokens_in), 0)::bigint AS total_tokens_in,
         COALESCE(SUM(tokens_out), 0)::bigint AS total_tokens_out,
         COALESCE(AVG(latency_ms), 0)::int AS avg_latency_ms,
         COUNT(*) FILTER (WHERE ok = FALSE)::int AS error_count
       FROM ai_usage_log
       WHERE created_at >= now() - ($1 || ' days')::interval`,
      [days]
    );

    res.json({
      ok: true,
      data: {
        summary: summary.rows[0],
        logs: logs.rows,
      },
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: { code: 'GET_AI_USAGE_FAILED', message: err.message },
    });
  }
});

// GET /api/pending
pendingRouter.get('/', async (req, res) => {
  try {
    await expirePendingActions();
    const result = await pool.query(
      `SELECT id, type, payload, wa_message_id, bot_reply_id, status, expires_at, created_at
       FROM pending_actions
       WHERE status = 'waiting' AND expires_at > now()
       ORDER BY created_at DESC`
    );
    res.json({ ok: true, data: result.rows });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: { code: 'GET_PENDING_FAILED', message: err.message },
    });
  }
});
