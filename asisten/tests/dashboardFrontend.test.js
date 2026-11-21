import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/api/server.js';
import { pool } from '../src/db/pool.js';
import { createAdmin } from '../scripts/create-admin.js';
import { escapeHtml, formatRupiah } from '../public/js/utils/format.js';

describe('Checkpoint E — Frontend Web Dashboard, Export CSV & Reports', () => {
  let server;
  let baseUrl;
  let authCookie;
  const testEmail = `test_fe_admin_${Date.now()}@example.com`;
  const testPassword = 'PasswordFe123!';

  beforeAll(async () => {
    // 1. Buat admin
    await createAdmin(testEmail, testPassword);

    // 2. Jalankan server
    const app = createServer();
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // 3. Login
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    authCookie = loginRes.headers.get('set-cookie');
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await pool.query('DELETE FROM admin_users WHERE email = $1', [testEmail]);
  });

  it('1. Web Dashboard: index.html dan berkas statis publik dapat diakses dengan benar', async () => {
    // 1.1 Root index.html
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('AsPri — Asisten Pribadi Dashboard');
    expect(html).toContain('id="app"');
    expect(html).toContain('src="/js/app.js"');

    // 1.2 Core JS modules
    const modules = [
      '/js/app.js',
      '/js/router.js',
      '/js/api.js',
      '/js/state.js',
      '/js/utils/format.js',
    ];
    for (const mod of modules) {
      const modRes = await fetch(`${baseUrl}${mod}`);
      expect(modRes.status).toBe(200);
      expect(modRes.headers.get('content-type')).toMatch(/javascript/);
    }

    // 1.3 Semua 10 modul halaman SPA
    const pageModules = [
      '/js/pages/login.js',
      '/js/pages/beranda.js',
      '/js/pages/transaksi.js',
      '/js/pages/kantong.js',
      '/js/pages/kalender.js',
      '/js/pages/catatan.js',
      '/js/pages/kategori.js',
      '/js/pages/bot.js',
      '/js/pages/log.js',
      '/js/pages/pengaturan.js',
    ];
    for (const page of pageModules) {
      const pageRes = await fetch(`${baseUrl}${page}`);
      expect(pageRes.status).toBe(200);
      expect(pageRes.headers.get('content-type')).toMatch(/javascript/);
    }
  });

  it('2. Export CSV: membutuhkan autentikasi (401 jika tanpa login)', async () => {
    const res = await fetch(`${baseUrl}/api/export/transactions.csv`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('3. Export CSV: mengembalikan berkas CSV dengan UTF-8 BOM dan header yang benar', async () => {
    const res = await fetch(`${baseUrl}/api/export/transactions.csv`, {
      headers: { Cookie: authCookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('attachment; filename="transaksi_');

    const arrayBuffer = await res.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    // Harus diawali oleh byte sequence UTF-8 BOM: 0xEF, 0xBB, 0xBF
    expect(bytes[0]).toBe(0xEF);
    expect(bytes[1]).toBe(0xBB);
    expect(bytes[2]).toBe(0xBF);

    // Periksa header kolom CSV
    const csvText = new TextDecoder('utf-8').decode(bytes.slice(3));
    const firstLine = csvText.split('\r\n')[0];
    expect(firstLine).toBe('ID,Tanggal,Tipe,Nominal,Kategori,Kantong,Catatan,Sumber');
  });

  it('4. Reports API: endpoint laporan kategori, tren bulanan, dan ringkasan bulanan', async () => {
    // 4.1 Laporan per kategori
    const catRes = await fetch(`${baseUrl}/api/reports/by-category`, {
      headers: { Cookie: authCookie },
    });
    expect(catRes.status).toBe(200);
    const catBody = await catRes.json();
    expect(catBody.ok).toBe(true);
    expect(catBody.data).toHaveProperty('byCategory');

    // 4.2 Tren bulanan
    const trendRes = await fetch(`${baseUrl}/api/reports/trend?months=6`, {
      headers: { Cookie: authCookie },
    });
    expect(trendRes.status).toBe(200);
    const trendBody = await trendRes.json();
    expect(trendBody.ok).toBe(true);
    expect(Array.isArray(trendBody.data)).toBe(true);

    // 4.3 Laporan bulanan
    const monthlyRes = await fetch(`${baseUrl}/api/reports/monthly`, {
      headers: { Cookie: authCookie },
    });
    expect(monthlyRes.status).toBe(200);
    const monthlyBody = await monthlyRes.json();
    expect(monthlyBody.ok).toBe(true);
    expect(monthlyBody.data).toHaveProperty('period');
  });

  it('5. Formatting & Anti-XSS Utilities', () => {
    // 5.1 Format Rupiah
    expect(formatRupiah(50000)).toMatch(/Rp\s*50\.000/);
    expect(formatRupiah(0)).toMatch(/Rp\s*0/);
    expect(formatRupiah(null)).toBe('Rp 0');

    // 5.2 Anti-XSS (escapeHtml)
    const dangerousInput = '<script>alert("XSS")</script>&foo=\'bar\'';
    const escaped = escapeHtml(dangerousInput);
    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain('&lt;script&gt;');
    expect(escaped).toContain('&quot;XSS&quot;');
    expect(escaped).toContain('&#039;bar&#039;');
    expect(escaped).toContain('&amp;foo=');
  });
});
