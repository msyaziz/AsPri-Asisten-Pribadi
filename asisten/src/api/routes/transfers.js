import { Router } from 'express';
import { z } from 'zod';
import {
  getTransfers,
  transferBetweenPockets,
  deleteTransfer,
} from '../../services/transfers.js';
import { ensureCurrentPeriod, ensurePeriod } from '../../services/periods.js';

const router = Router();

// GET /api/transfers
router.get('/', async (req, res) => {
  try {
    const filter = {
      periodId: req.query.periodId ? Number(req.query.periodId) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : 50,
      offset: req.query.offset ? Number(req.query.offset) : 0,
    };
    const transfers = await getTransfers(filter);
    res.json({ ok: true, data: transfers });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: err.message },
    });
  }
});

const createTransferSchema = z.object({
  fromPocketId: z.coerce.number().nullable().optional(),
  toPocketId: z.coerce.number().nullable().optional(),
  amount: z.coerce.number().positive('Nominal transfer harus lebih besar dari 0'),
  note: z.string().nullable().optional(),
  transferDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD').optional(),
  periodId: z.coerce.number().optional(),
});

// POST /api/transfers
router.post('/', async (req, res) => {
  const parsed = createTransferSchema.safeParse(req.body);
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
    // Jika periodId tidak dikirim, gunakan periode berjalan
    let periodId = parsed.data.periodId;
    if (!periodId) {
      const curPeriod = await ensureCurrentPeriod();
      periodId = curPeriod.id;
    }

    const transfer = await transferBetweenPockets({
      ...parsed.data,
      periodId,
    });
    res.json({ ok: true, data: transfer });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: { code: 'TRANSFER_FAILED', message: err.message },
    });
  }
});

// DELETE /api/transfers/:id
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'ID transfer tidak valid.' },
    });
  }

  try {
    const deleted = await deleteTransfer(id);
    res.json({ ok: true, data: { message: 'Transfer berhasil dibatalkan.', transfer: deleted } });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: { code: 'DELETE_TRANSFER_FAILED', message: err.message },
    });
  }
});

export default router;

