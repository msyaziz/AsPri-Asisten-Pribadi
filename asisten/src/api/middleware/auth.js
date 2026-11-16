import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';

export const COOKIE_NAME = 'jwt';

/**
 * Middleware untuk memverifikasi autentikasi JWT pengguna (via cookie atau Authorization header).
 */
export function requireAuth(req, res, next) {
  let token = null;

  // 1. Cek cookie httpOnly
  if (req.cookies && req.cookies[COOKIE_NAME]) {
    token = req.cookies[COOKIE_NAME];
  }
  // 2. Cek Authorization header (Bearer token) untuk kemudahan pengujian / CLI
  else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.slice(7).trim();
  }

  if (!token) {
    return res.status(401).json({
      ok: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Sesi tidak valid atau telah berakhir. Silakan login kembali.',
      },
    });
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      ok: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Token otentikasi tidak valid atau sudah kedaluwarsa.',
      },
    });
  }
}

/**
 * Middleware proteksi CSRF untuk metode ubah-data (POST, PUT, PATCH, DELETE).
 * Memverifikasi header Origin jika ada agar sesuai dengan Host aplikasi.
 */
export function verifyOrigin(req, res, next) {
  const mutatingMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
  if (!mutatingMethods.includes(req.method)) {
    return next();
  }

  const origin = req.headers.origin;
  if (!origin) {
    // Jika tidak ada header Origin (misal direct request tanpa origin header), izinkan lanjut
    return next();
  }

  try {
    const originUrl = new URL(origin);
    const hostHeader = req.headers.host;

    // Bandingkan host origin dengan host request
    if (originUrl.host !== hostHeader) {
      return res.status(403).json({
        ok: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Origin tidak diizinkan (proteksi CSRF).',
        },
      });
    }
  } catch (e) {
    return res.status(403).json({
      ok: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Header Origin tidak valid.',
      },
    });
  }

  next();
}

/**
 * Helper untuk menandatangani JWT token sesi admin (12 jam).
 */
export function signAuthToken(payload) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '12h' });
}

/**
 * Helper untuk opsi cookie sesi.
 */
export function getAuthCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.COOKIE_SECURE,
    maxAge: 12 * 60 * 60 * 1000, // 12 jam
    path: '/',
  };
}
