import { Router } from 'express';
import { getStatus } from '../../bot/connection.js';

export const botRouter = Router();

botRouter.get('/status', (req, res) => {
  try {
    const status = getStatus();
    // Kembalikan hanya field yang diizinkan (tanpa QR / info sensitif)
    res.json({
      state: status.state,
      since: status.since,
      droppedCount: status.droppedCount,
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil status bot' });
  }
});

export default botRouter;
