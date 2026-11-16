import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import http from 'http';
import { createCloudflareAccessMiddleware } from '../src/api/middleware/cloudflareAccess.js';
import { createServer } from '../src/api/server.js';

describe('Checkpoint B — Hook Cloudflare Access & Unit Test JWT Tiruan', () => {
  let mainServer;
  let mainBaseUrl;
  let mockJwksServer;
  let mockJwksUrl;

  // Pasangan kunci RSA 1 (Kunci Valid)
  const { publicKey: pubKey1, privateKey: privKey1 } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  // Pasangan kunci RSA 2 (Kunci Asing / Penyerang)
  const { publicKey: pubKey2, privateKey: privKey2 } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const validAud = 'test-cf-access-aud-12345';
  const validKid = 'test-key-id-1';

  beforeAll(async () => {
    // 1. Jalankan server aplikasi utama (default: CF_ACCESS_ENABLED=false)
    const app = createServer();
    mainServer = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    mainBaseUrl = `http://127.0.0.1:${mainServer.address().port}`;

    // 2. Jalankan mock JWKS endpoint
    const jwksApp = express();
    jwksApp.get('/cdn-cgi/access/certs', (req, res) => {
      res.json({
        keys: [
          {
            kid: validKid,
            cert: pubKey1,
          },
        ],
      });
    });
    mockJwksServer = await new Promise((resolve) => {
      const s = jwksApp.listen(0, '127.0.0.1', () => resolve(s));
    });
    mockJwksUrl = `http://127.0.0.1:${mockJwksServer.address().port}/cdn-cgi/access/certs`;
  });

  afterAll(async () => {
    if (mainServer) await new Promise((resolve) => mainServer.close(resolve));
    if (mockJwksServer) await new Promise((resolve) => mockJwksServer.close(resolve));
  });

  it('1. Flag default (CF_ACCESS_ENABLED=false) tidak mengganggu request tanpa header Cf-Access-Jwt-Assertion', async () => {
    const res = await fetch(`${mainBaseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('2. Flag hidup (enabled=true) tanpa header Cf-Access-Jwt-Assertion mengembalikan 403', async () => {
    const testApp = express();
    testApp.use(createCloudflareAccessMiddleware({ enabled: true, aud: validAud, publicKey: pubKey1 }));
    testApp.get('/test', (req, res) => res.json({ ok: true }));

    const s = await new Promise((resolve) => {
      const server = testApp.listen(0, '127.0.0.1', () => resolve(server));
    });
    const url = `http://127.0.0.1:${s.address().port}/test`;

    try {
      const res = await fetch(url);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
      expect(body.error.message).toContain('Cf-Access-Jwt-Assertion');
    } finally {
      await new Promise((resolve) => s.close(resolve));
    }
  });

  it('3. Token JWT tiruan valid (RS256, aud cocok, signature valid) berhasil lolos (200)', async () => {
    const token = jwt.sign({ email: 'user@example.com', aud: validAud }, privKey1, {
      algorithm: 'RS256',
      expiresIn: '1h',
      keyid: validKid,
    });

    const testApp = express();
    testApp.use(
      createCloudflareAccessMiddleware({
        enabled: true,
        aud: validAud,
        jwksUri: mockJwksUrl,
      })
    );
    testApp.get('/test', (req, res) => res.json({ ok: true, user: req.cfAccessUser.email }));

    const s = await new Promise((resolve) => {
      const server = testApp.listen(0, '127.0.0.1', () => resolve(server));
    });
    const url = `http://127.0.0.1:${s.address().port}/test`;

    try {
      const res = await fetch(url, {
        headers: {
          'Cf-Access-Jwt-Assertion': token,
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.user).toBe('user@example.com');
    } finally {
      await new Promise((resolve) => s.close(resolve));
    }
  });

  it('4. Token JWT tiruan kedaluwarsa ditolak dengan 403', async () => {
    // Buat token yang sudah kedaluwarsa 10 detik lalu
    const expiredToken = jwt.sign(
      { email: 'user@example.com', aud: validAud, exp: Math.floor(Date.now() / 1000) - 10 },
      privKey1,
      { algorithm: 'RS256', keyid: validKid }
    );

    const testApp = express();
    testApp.use(
      createCloudflareAccessMiddleware({
        enabled: true,
        aud: validAud,
        publicKey: pubKey1,
      })
    );
    testApp.get('/test', (req, res) => res.json({ ok: true }));

    const s = await new Promise((resolve) => {
      const server = testApp.listen(0, '127.0.0.1', () => resolve(server));
    });
    const url = `http://127.0.0.1:${s.address().port}/test`;

    try {
      const res = await fetch(url, {
        headers: {
          'Cf-Access-Jwt-Assertion': expiredToken,
        },
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error.message).toContain('jwt expired');
    } finally {
      await new Promise((resolve) => s.close(resolve));
    }
  });

  it('5. Token JWT dengan aud yang salah ditolak dengan 403', async () => {
    const wrongAudToken = jwt.sign(
      { email: 'user@example.com', aud: 'salah-aud-99999' },
      privKey1,
      { algorithm: 'RS256', expiresIn: '1h', keyid: validKid }
    );

    const testApp = express();
    testApp.use(
      createCloudflareAccessMiddleware({
        enabled: true,
        aud: validAud,
        publicKey: pubKey1,
      })
    );
    testApp.get('/test', (req, res) => res.json({ ok: true }));

    const s = await new Promise((resolve) => {
      const server = testApp.listen(0, '127.0.0.1', () => resolve(server));
    });
    const url = `http://127.0.0.1:${s.address().port}/test`;

    try {
      const res = await fetch(url, {
        headers: {
          'Cf-Access-Jwt-Assertion': wrongAudToken,
        },
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error.message).toContain('jwt audience invalid');
    } finally {
      await new Promise((resolve) => s.close(resolve));
    }
  });

  it('6. Token JWT dengan signature salah (ditandatangani private key lain) ditolak dengan 403', async () => {
    // Ditandatangani oleh privKey2, tetapi server memverifikasi dengan pubKey1
    const badSigToken = jwt.sign(
      { email: 'attacker@example.com', aud: validAud },
      privKey2,
      { algorithm: 'RS256', expiresIn: '1h', keyid: validKid }
    );

    const testApp = express();
    testApp.use(
      createCloudflareAccessMiddleware({
        enabled: true,
        aud: validAud,
        publicKey: pubKey1,
      })
    );
    testApp.get('/test', (req, res) => res.json({ ok: true }));

    const s = await new Promise((resolve) => {
      const server = testApp.listen(0, '127.0.0.1', () => resolve(server));
    });
    const url = `http://127.0.0.1:${s.address().port}/test`;

    try {
      const res = await fetch(url, {
        headers: {
          'Cf-Access-Jwt-Assertion': badSigToken,
        },
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error.message).toContain('invalid signature');
    } finally {
      await new Promise((resolve) => s.close(resolve));
    }
  });
});

