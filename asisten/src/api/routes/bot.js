import { Router } from 'express';
import { getStatus } from '../../bot/connection.js';

export const botRouter = Router();

botRouter.get('/status', (req, res) => {
  try {
    const status = getStatus();
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
