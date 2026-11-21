import { Router } from 'express';
import { getStatus, restartBot, generateQrSvg } from '../../bot/connection.js';

export const botRouter = Router();

// GET /api/bot/status
botRouter.get('/status', (req, res) => {
  try {
    const status = getStatus();
    res.json({
      ok: true,
      data: {
        state: status.state,
        since: status.since,
        droppedCount: status.droppedCount,
        lastQrAt: status.lastQrAt,
      },
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: { code: 'BOT_STATUS_FAILED', message: err.message },
    });
  }
});

// GET /api/bot/qr
botRouter.get('/qr', (req, res) => {
  try {
    const status = getStatus();
    if (status.state !== 'qr_ready' || !status.rawQr) {
      return res.status(404).json({
        ok: false,
        error: {
          code: 'QR_NOT_READY',
          message: 'QR code tidak tersedia atau bot sudah terhubung.',
        },
      });
    }

    if (req.query.format === 'svg') {
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.send(generateQrSvg(status.rawQr));
    }

    res.json({
      ok: true,
      data: {
        qr: status.rawQr,
        svg: generateQrSvg(status.rawQr),
        lastQrAt: status.lastQrAt,
      },
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: { code: 'BOT_QR_FAILED', message: err.message },
    });
  }
});

// POST /api/bot/restart
botRouter.post('/restart', async (req, res) => {
  try {
    // Jalankan restart di background tanpa menggantung request
    restartBot().catch(() => {});
    res.json({
      ok: true,
      data: { message: 'Perintah restart bot telah dikirim.' },
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: { code: 'BOT_RESTART_FAILED', message: err.message },
    });
  }
});

export default botRouter;
