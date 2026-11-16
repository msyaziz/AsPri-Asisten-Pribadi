import { Router } from 'express';
import { z } from 'zod';
import {
  getTransactions,
  addTransaction,
  updateTransaction,
  deleteTransaction,
  restoreTransaction,
  getTransactionById,
} from '../../services/transactions.js';

const router = Router();

// GET /api/transactions
router.get('/', async (req, res) => {
  try {
    const result = await getTransactions(req.query);
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: err.message },
    });
  }
});

// GET /api/transactions/:id
router.get('/:id', async (req, res) => {
  const txId = parseInt(req.params.id, 10);
  if (isNaN(txId)) {
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'ID transaksi tidak valid.' },
    });
  }

  try {
    const tx = await getTransactionById(txId);
    if (!tx) {
      return res.status(404).json({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Transaksi tidak ditemukan.' },
      });
    }
    res.json({ ok: true, data: tx });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: err.message },
    });
  }
});

const createTransactionSchema = z.object({
  type: z.enum(['masuk', 'keluar']),
  amount: z.coerce.number().positive('Nominal harus lebih besar dari 0'),
  categoryId: z.coerce.number().nullable().optional(),
  pocketId: z.coerce.number().nullable().optional(),
  note: z.string().nullable().optional(),
  txDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD').optional(),
});

// POST /api/transactions
router.post('/', async (req, res) => {
  const parsed = createTransactionSchema.safeParse(req.body);
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
    const tx = await addTransaction({
      ...parsed.data,
      source: 'dashboard',
    });
    res.json({ ok: true, data: tx });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: { code: 'CREATE_TX_FAILED', message: err.message },
    });
  }
});

const updateTransactionSchema = z.object({
  amount: z.coerce.number().positive().optional(),
  categoryId: z.coerce.number().nullable().optional(),
  pocketId: z.coerce.number().nullable().optional(),
  note: z.string().nullable().optional(),
});

// PATCH /api/transactions/:id
router.patch('/:id', async (req, res) => {
  const txId = parseInt(req.params.id, 10);
  if (isNaN(txId)) {
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'ID transaksi tidak valid.' },
    });
  }

  const parsed = updateTransactionSchema.safeParse(req.body);
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
    const tx = await updateTransaction(txId, parsed.data);
    res.json({ ok: true, data: tx });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: { code: 'UPDATE_TX_FAILED', message: err.message },
    });
  }
});

// DELETE /api/transactions/:id
router.delete('/:id', async (req, res) => {
  const txId = parseInt(req.params.id, 10);
  if (isNaN(txId)) {
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'ID transaksi tidak valid.' },
    });
  }

  try {
    const deleted = await deleteTransaction(txId);
    res.json({ ok: true, data: { message: 'Transaksi berhasil dihapus.', transaction: deleted } });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: { code: 'DELETE_TX_FAILED', message: err.message },
    });
  }
});

// POST /api/transactions/:id/restore
router.post('/:id/restore', async (req, res) => {
  const txId = parseInt(req.params.id, 10);
  if (isNaN(txId)) {
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'ID transaksi tidak valid.' },
    });
  }

  try {
    const restored = await restoreTransaction(txId);
    res.json({ ok: true, data: { message: 'Transaksi berhasil dipulihkan.', transaction: restored } });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: { code: 'RESTORE_TX_FAILED', message: err.message },
    });
  }
});

export default router;

