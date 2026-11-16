import { Router } from 'express';
import { z } from 'zod';
import { listPeriods, getPeriodById } from '../../services/periods.js';
import { closePeriod, recomputePeriod } from '../../services/rollover.js';
import { setMonthlyIncome } from '../../services/transactions.js';
import { setAllocations } from '../../services/pockets.js';

const router = Router();

// GET /api/periods
router.get('/', async (req, res) => {
  try {
    const periods = await listPeriods();
    res.json({ ok: true, data: periods });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: err.message },
    });
  }
});

// POST /api/periods/:id/close
router.post('/:id/close', async (req, res) => {
  const periodId = parseInt(req.params.id, 10);
  if (isNaN(periodId)) {
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'ID periode tidak valid.' },
    });
  }

  try {
    const result = await closePeriod(periodId);
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: { code: 'CLOSE_PERIOD_FAILED', message: err.message },
    });
  }
});

// POST /api/periods/:id/recompute
router.post('/:id/recompute', async (req, res) => {
  const periodId = parseInt(req.params.id, 10);
  if (isNaN(periodId)) {
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'ID periode tidak valid.' },
    });
  }

  try {
    const result = await recomputePeriod(periodId);
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: { code: 'RECOMPUTE_FAILED', message: err.message },
    });
  }
});

const monthlyIncomeSchema = z.object({
  amount: z.coerce.number().positive('Nominal uang bulanan harus lebih besar dari 0.'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD').optional(),
});

// PUT /api/periods/:id/monthly-income
router.put('/:id/monthly-income', async (req, res) => {
  const periodId = parseInt(req.params.id, 10);
  if (isNaN(periodId)) {
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'ID periode tidak valid.' },
    });
  }

  const parsed = monthlyIncomeSchema.safeParse(req.body);
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
    const result = await setMonthlyIncome({
      periodId,
      amount: parsed.data.amount,
      txDate: parsed.data.date,
      source: 'dashboard',
    });
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: { code: 'SET_INCOME_FAILED', message: err.message },
    });
  }
});

const allocationsSchema = z.object({
  allocations: z.array(
    z.object({
      pocketId: z.coerce.number(),
      percent: z.coerce.number().min(0).max(100),
    })
  ),
});

// PUT /api/periods/:id/allocations
router.put('/:id/allocations', async (req, res) => {
  const periodId = parseInt(req.params.id, 10);
  if (isNaN(periodId)) {
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'ID periode tidak valid.' },
    });
  }

  const parsed = allocationsSchema.safeParse(req.body);
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
    const items = parsed.data.allocations.map((a) => ({
      pocketId: a.pocketId,
      percent: a.percent,
    }));
    const result = await setAllocations(periodId, items);
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: { code: 'SET_ALLOCATIONS_FAILED', message: err.message },
    });
  }
});

export default router;

