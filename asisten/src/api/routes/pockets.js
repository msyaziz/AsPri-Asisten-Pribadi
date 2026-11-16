import { Router } from 'express';
import { z } from 'zod';
import {
  getPocketBalances,
  createPocket,
  updatePocket,
  getPocketById,
} from '../../services/pockets.js';
import { ensureCurrentPeriod, ensurePeriod } from '../../services/periods.js';

const router = Router();

// GET /api/pockets
router.get('/', async (req, res) => {
  try {
    let period;
    if (req.query.period && /^\d{4}-\d{2}$/.test(req.query.period)) {
      const [y, m] = req.query.period.split('-').map(Number);
      period = await ensurePeriod(y, m);
    } else {
      period = await ensureCurrentPeriod();
    }

    const pockets = await getPocketBalances(period.id);
    res.json({ ok: true, data: pockets });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: err.message },
    });
  }
});

const createPocketSchema = z.object({
  name: z.string().min(1, 'Nama kantong wajib diisi'),
  rolloverMode: z.enum(['carry', 'return']).default('carry'),
  sortOrder: z.coerce.number().optional().default(0),
  isSavingsGoal: z.boolean().optional().default(false),
});

// POST /api/pockets
router.post('/', async (req, res) => {
  const parsed = createPocketSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message || 'Input tidak valid',
      },
    });
  }

  try {
    const { name, rolloverMode, sortOrder } = parsed.data;
    const pocket = await createPocket(name, rolloverMode, sortOrder);
    res.json({ ok: true, data: pocket });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: { code: 'CREATE_POCKET_FAILED', message: err.message },
    });
  }
});

const updatePocketSchema = z.object({
  name: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().optional(),
  rolloverMode: z.enum(['carry', 'return']).optional(),
});

// PATCH /api/pockets/:id
router.patch('/:id', async (req, res) => {
  const pocketId = parseInt(req.params.id, 10);
  if (isNaN(pocketId)) {
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'ID kantong tidak valid.' },
    });
  }

  const parsed = updatePocketSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message || 'Input tidak valid',
      },
    });
  }

  try {
    const pocket = await updatePocket(pocketId, parsed.data);
    res.json({ ok: true, data: pocket });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: { code: 'UPDATE_POCKET_FAILED', message: err.message },
    });
  }
});

export default router;

