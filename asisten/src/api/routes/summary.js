import { Router } from 'express';
import { getPeriodSummary } from '../../services/periods.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const summary = await getPeriodSummary(req.query.period);
    res.json({ ok: true, data: summary });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: err.message },
    });
  }
});

export default router;

