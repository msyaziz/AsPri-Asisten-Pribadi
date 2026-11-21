import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';

const router = Router();

// GET /api/settings
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT key, value, updated_at FROM settings ORDER BY key ASC');
    const settingsMap = {};
    for (const row of result.rows) {
      settingsMap[row.key] = row.value;
    }
    res.json({
      ok: true,
      data: {
        settings: settingsMap,
        raw: result.rows,
      },
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: { code: 'GET_SETTINGS_FAILED', message: err.message },
    });
  }
});

const updateSettingsSchema = z.record(z.any());

// PUT /api/settings
router.put('/', async (req, res) => {
  const parsed = updateSettingsSchema.safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Payload pengaturan tidak valid atau kosong.' },
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [key, val] of Object.entries(parsed.data)) {
      await client.query(
        `INSERT INTO settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_at = now()`,
        [key, JSON.stringify(val)]
      );
    }
    await client.query('COMMIT');

    const result = await client.query('SELECT key, value, updated_at FROM settings ORDER BY key ASC');
    const settingsMap = {};
    for (const row of result.rows) {
      settingsMap[row.key] = row.value;
    }
    res.json({ ok: true, data: settingsMap });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({
      ok: false,
      error: { code: 'UPDATE_SETTINGS_FAILED', message: err.message },
    });
  } finally {
    client.release();
  }
});

export default router;
