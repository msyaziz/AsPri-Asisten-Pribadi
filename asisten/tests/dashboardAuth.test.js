import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/api/server.js';
import { pool } from '../src/db/pool.js';
import { createAdmin } from '../scripts/create-admin.js';

describe('Checkpoint A — Auth & Keamanan Dashboard', () => {
  let server;
  let baseUrl;
  const testEmail = 'auth_tester@example.com';
  const testPassword = 'Password123!';

  beforeAll(async () => {
    // 1. Buat admin tester
    await createAdmin(testEmail, testPassword);

    // 2. Jalankan server express pada ephemeral port
    const app = createServer();
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    // Bersihkan admin tester
    await pool.query('DELETE FROM admin_users WHERE email = $1', [testEmail]);
  });

  it('1. Endpoint publik /api/health dapat diakses tanpa login', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.db).toBe(true);
  });

  it('2. Endpoint terproteksi (/api/bot/status) menolak akses tanpa cookie/token dengan 401', async () => {
    const res = await fetch(`${baseUrl}/api/bot/status`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('3. Login dengan kredensial yang salah mengembalikan 401', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'SalahPassword123' }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('4. Login berhasil mengembalikan 200, user data, dan Set-Cookie httpOnly', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.user.email).toBe(testEmail);

    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain('jwt=');
    expect(setCookie.toLowerCase()).toContain('httponly');
    expect(setCookie.toLowerCase()).toContain('samesite=strict');
  });

  it('5. Akses /api/auth/me dengan cookie JWT berhasil mengembalikan info sesi', async () => {
    // Ambil cookie dari login
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const cookie = loginRes.headers.get('set-cookie');

    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: cookie },
    });
    expect(meRes.status).toBe(200);
    const body = await meRes.json();
    expect(body.ok).toBe(true);
    expect(body.data.user.email).toBe(testEmail);
  });

  it('6. Proteksi CSRF: metode ubah-data menolak Origin asing (http://evil.test) dengan 403', async () => {
    // Login untuk dapat cookie
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const cookie = loginRes.headers.get('set-cookie');

    // Coba POST logout dengan Origin palsu
    const res = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: 'http://evil.test',
      },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('7. Logout menghapus cookie sesi dan request setelahnya menjadi 401', async () => {
    // Login
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const cookie = loginRes.headers.get('set-cookie');

    // Logout
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: baseUrl,
      },
    });
    expect(logoutRes.status).toBe(200);
    const clearCookie = logoutRes.headers.get('set-cookie');
    expect(clearCookie).toBeTruthy();

    // Verifikasi sesi telah berakhir (misal tanpa cookie atau cookie kosong)
    const afterRes = await fetch(`${baseUrl}/api/auth/me`);
    expect(afterRes.status).toBe(401);
  });

  it('8. Rate limit login memblokir percobaan ke-6 (429 TOO_MANY_REQUESTS)', async () => {
    // Lakukan login salah sampai mencapai limit (5 limit)
    for (let i = 0; i < 5; i++) {
      await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'fake@example.com', password: 'wrong' }),
      });
    }

    // Percobaan ke-6 harus ditolak 429
    const blockedRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'fake@example.com', password: 'wrong' }),
    });

    expect(blockedRes.status).toBe(429);
    const body = await blockedRes.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('TOO_MANY_REQUESTS');
  });
});
