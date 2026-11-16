import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { pool } from '../../db/pool.js';
import {
  COOKIE_NAME,
  requireAuth,
  signAuthToken,
  getAuthCookieOptions,
} from '../middleware/auth.js';

const router = Router();

// Rate limit login: 5 percobaan per 15 menit per IP
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Terlalu banyak percobaan login yang gagal. Silakan coba lagi setelah 15 menit.',
    },
  },
});

const loginSchema = z.object({
  email: z.string().email('Format email tidak valid'),
  password: z.string().min(1, 'Password wajib diisi'),
});

router.post('/login', loginLimiter, async (req, res) => {
  const parseResult = loginSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: parseResult.error.issues[0]?.message || 'Input tidak valid',
      },
    });
  }

  const { email, password } = parseResult.data;

  try {
    const { rows } = await pool.query(
      'SELECT id, email, password_hash FROM admin_users WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    const user = rows[0];
    if (!user) {
      return res.status(401).json({
        ok: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Email atau password salah.',
        },
      });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        ok: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Email atau password salah.',
        },
      });
    }

    // Perbarui last_login_at
    await pool.query('UPDATE admin_users SET last_login_at = now() WHERE id = $1', [user.id]);

    const token = signAuthToken({ id: user.id, email: user.email });
    res.cookie(COOKIE_NAME, token, getAuthCookieOptions());

    return res.json({
      ok: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
        },
      },
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: err.message,
      },
    });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  return res.json({
    ok: true,
    data: {
      message: 'Logout berhasil.',
    },
  });
});

router.get('/me', requireAuth, (req, res) => {
  return res.json({
    ok: true,
    data: {
      user: {
        id: req.user.id,
        email: req.user.email,
      },
    },
  });
});

export default router;

