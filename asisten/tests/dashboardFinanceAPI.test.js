import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/api/server.js';
import { pool } from '../src/db/pool.js';
import { createAdmin } from '../scripts/create-admin.js';
import { ensurePeriod, getMainBalance, ensureCurrentPeriod } from '../src/services/periods.js';
import { getPocketBalances } from '../src/services/pockets.js';

describe('Checkpoint C — API Keuangan Dashboard', () => {
  let server;
  let baseUrl;
  let authCookie;
  const testEmail = 'finance_tester@example.com';
  const testPassword = 'Password123!';
  let testPeriod;

  beforeAll(async () => {
    // 1. Buat admin tester
    await createAdmin(testEmail, testPassword);

    // 2. Jalankan server express
    const app = createServer();
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    // 3. Login untuk mendapatkan authCookie
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    authCookie = loginRes.headers.get('set-cookie');

    // 4. Pastikan periode berjalan ada
    testPeriod = await ensureCurrentPeriod();

    // Reset data periode uji 2024-01 dan 2024-02 dan sisa test sebelumnya
    await pool.query("DELETE FROM pocket_transfers WHERE note LIKE 'TEST_DASHBOARD_%'");
    await pool.query("DELETE FROM transactions WHERE note LIKE 'TEST_DASHBOARD_%'");
    await pool.query("DELETE FROM period_pockets WHERE pocket_id IN (SELECT id FROM pockets WHERE name LIKE 'TEST_DASHBOARD_%')");
    await pool.query("DELETE FROM pockets WHERE name LIKE 'TEST_DASHBOARD_%'");
    await pool.query("UPDATE periods SET status = 'open', closed_at = NULL WHERE (year = 2024 AND month = 1) OR (year = 2024 AND month = 2)");
    await pool.query("UPDATE periods SET main_opening = 0 WHERE year = 2024 AND month = 2");
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    // Bersihkan data uji
    await pool.query('DELETE FROM admin_users WHERE email = $1', [testEmail]);
    await pool.query("DELETE FROM transactions WHERE note LIKE 'TEST_DASHBOARD_%'");
    await pool.query("DELETE FROM pocket_transfers WHERE note LIKE 'TEST_DASHBOARD_%'");
    await pool.query("DELETE FROM period_pockets WHERE pocket_id IN (SELECT id FROM pockets WHERE name LIKE 'TEST_DASHBOARD_%')");
    await pool.query("DELETE FROM pockets WHERE name LIKE 'TEST_DASHBOARD_%'");
  });

  it('1. Semua endpoint keuangan menolak akses tanpa autentikasi (401)', async () => {
    const endpoints = [
      '/api/summary',
      '/api/periods',
      '/api/pockets',
      '/api/transactions',
      '/api/transfers',
    ];

    for (const ep of endpoints) {
      const res = await fetch(`${baseUrl}${ep}`);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    }
  });

  it('2. GET /api/summary mengembalikan angka yang sama persis dengan service bot', async () => {
    const res = await fetch(`${baseUrl}/api/summary?period=${testPeriod.year}-${String(testPeriod.month).padStart(2, '0')}`, {
      headers: { Cookie: authCookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Bandingkan langsung dengan nilai dari service yang dipakai bot (view database)
    const expectedMainBal = await getMainBalance(testPeriod.id);
    const expectedPockets = await getPocketBalances(testPeriod.id);

    expect(body.data.mainBalance).toBe(Number(expectedMainBal));
    expect(body.data.pockets.length).toBe(expectedPockets.length);
    for (let i = 0; i < expectedPockets.length; i++) {
      expect(body.data.pockets[i].balance).toBe(Number(expectedPockets[i].balance));
      expect(body.data.pockets[i].pocketName).toBe(expectedPockets[i].pocketName);
    }
  });

  it('3. GET /api/periods mengembalikan daftar periode', async () => {
    const res = await fetch(`${baseUrl}/api/periods`, {
      headers: { Cookie: authCookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.some((p) => p.id === testPeriod.id)).toBe(true);
  });

  it('4. POST & PATCH /api/pockets: membuat dan mengubah kantong', async () => {
    // Buat kantong baru
    const createRes = await fetch(`${baseUrl}/api/pockets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie,
        Origin: baseUrl,
      },
      body: JSON.stringify({
        name: 'TEST_DASHBOARD_Liburan',
        rolloverMode: 'carry',
        sortOrder: 10,
      }),
    });
    expect(createRes.status).toBe(200);
    const createBody = await createRes.json();
    expect(createBody.ok).toBe(true);
    const newPocketId = createBody.data.id;

    // Update kantong
    const patchRes = await fetch(`${baseUrl}/api/pockets/${newPocketId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie,
        Origin: baseUrl,
      },
      body: JSON.stringify({
        name: 'TEST_DASHBOARD_Liburan_Updated',
        rolloverMode: 'return',
      }),
    });
    expect(patchRes.status).toBe(200);
    const patchBody = await patchRes.json();
    expect(patchBody.ok).toBe(true);
    expect(patchBody.data.name).toBe('TEST_DASHBOARD_Liburan_Updated');
    expect(patchBody.data.rollover_mode).toBe('return');
  });

  it('5. PUT /api/periods/:id/allocations: mengatur alokasi kantong', async () => {
    // Ambil kantong pertama
    const pockets = await getPocketBalances(testPeriod.id);
    const firstPocket = pockets[0];

    const res = await fetch(`${baseUrl}/api/periods/${testPeriod.id}/allocations`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie,
        Origin: baseUrl,
      },
      body: JSON.stringify({
        allocations: [{ pocketId: firstPocket.pocketId, percent: 15 }],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  let createdTxId;

  it('6. POST, GET, PATCH, DELETE, RESTORE /api/transactions: siklus hidup transaksi memperbarui saldo', async () => {
    // Ambil saldo awal
    const balBefore = await getMainBalance(testPeriod.id);

    // 1. POST Tambah transaksi dari dashboard
    const postRes = await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie,
        Origin: baseUrl,
      },
      body: JSON.stringify({
        type: 'keluar',
        amount: 35000,
        note: 'TEST_DASHBOARD_Kopi Sore',
      }),
    });
    expect(postRes.status).toBe(200);
    const postBody = await postRes.json();
    expect(postBody.ok).toBe(true);
    expect(postBody.data.source).toBe('dashboard');
    createdTxId = postBody.data.id;

    // Saldo utama berkurang 35.000
    const balAfterPost = await getMainBalance(testPeriod.id);
    expect(balAfterPost).toBe(balBefore - 35000n);

    // 2. GET Filter transaksi
    const getRes = await fetch(`${baseUrl}/api/transactions?q=TEST_DASHBOARD_Kopi`, {
      headers: { Cookie: authCookie },
    });
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.ok).toBe(true);
    expect(getBody.data.transactions.length).toBeGreaterThanOrEqual(1);

    // 3. PATCH Edit nominal transaksi (jadi 40.000)
    const patchRes = await fetch(`${baseUrl}/api/transactions/${createdTxId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie,
        Origin: baseUrl,
      },
      body: JSON.stringify({
        amount: 40000,
        note: 'TEST_DASHBOARD_Kopi Sore Ralat',
      }),
    });
    expect(patchRes.status).toBe(200);
    const patchBody = await patchRes.json();
    expect(patchBody.ok).toBe(true);
    expect(patchBody.data.amount).toBe(40000);

    const balAfterPatch = await getMainBalance(testPeriod.id);
    expect(balAfterPatch).toBe(balBefore - 40000n);

    // 4. DELETE Hapus transaksi (soft delete)
    const deleteRes = await fetch(`${baseUrl}/api/transactions/${createdTxId}`, {
      method: 'DELETE',
      headers: {
        Cookie: authCookie,
        Origin: baseUrl,
      },
    });
    expect(deleteRes.status).toBe(200);
    const deleteBody = await deleteRes.json();
    expect(deleteBody.ok).toBe(true);

    // Saldo pulih kembali ke semula
    const balAfterDelete = await getMainBalance(testPeriod.id);
    expect(balAfterDelete).toBe(balBefore);

    // 5. RESTORE Pulihkan transaksi yang dihapus
    const restoreRes = await fetch(`${baseUrl}/api/transactions/${createdTxId}/restore`, {
      method: 'POST',
      headers: {
        Cookie: authCookie,
        Origin: baseUrl,
      },
    });
    expect(restoreRes.status).toBe(200);
    const restoreBody = await restoreRes.json();
    expect(restoreBody.ok).toBe(true);

    // Saldo terpotong kembali
    const balAfterRestore = await getMainBalance(testPeriod.id);
    expect(balAfterRestore).toBe(balBefore - 40000n);
  });

  it('7. POST & DELETE /api/transfers: transfer antar kantong/saldo utama', async () => {
    // Beri saldo pada periode uji agar Saldo Utama cukup untuk ditransfer
    await pool.query(
      "INSERT INTO transactions (period_id, type, amount, note, tx_date) VALUES ($1, 'masuk', 100000, 'TEST_DASHBOARD_Income_Transfer', CURRENT_DATE)",
      [testPeriod.id]
    );

    const pockets = await getPocketBalances(testPeriod.id);
    const targetPocket = pockets[0];

    // Transfer dari saldo utama ke kantong
    const postRes = await fetch(`${baseUrl}/api/transfers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie,
        Origin: baseUrl,
      },
      body: JSON.stringify({
        periodId: testPeriod.id,
        fromPocketId: null, // Utama
        toPocketId: targetPocket.pocketId,
        amount: 25000,
        note: 'TEST_DASHBOARD_TransferUtamaKeKantong',
      }),
    });
    expect(postRes.status).toBe(200);
    const postBody = await postRes.json();
    expect(postBody.ok).toBe(true);
    const transferId = postBody.data.id;

    // GET transfers
    const getRes = await fetch(`${baseUrl}/api/transfers`, {
      headers: { Cookie: authCookie },
    });
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.ok).toBe(true);
    expect(getBody.data.some((t) => t.id === transferId)).toBe(true);

    // DELETE batalkan transfer
    const delRes = await fetch(`${baseUrl}/api/transfers/${transferId}`, {
      method: 'DELETE',
      headers: {
        Cookie: authCookie,
        Origin: baseUrl,
      },
    });
    expect(delRes.status).toBe(200);
    const delBody = await delRes.json();
    expect(delBody.ok).toBe(true);
  });

  it('8. Edit transaksi pada periode tertutup memicu recompute berantai dan hasilnya benar', async () => {
    // Siapkan periode masa lalu khusus uji: 2024-01 dan 2024-02
    const pastP1 = await ensurePeriod(2024, 1);
    const pastP2 = await ensurePeriod(2024, 2);

    // Masukkan uang bulanan di P1 sebesar 1.000.000
    await pool.query(
      `INSERT INTO transactions (period_id, type, amount, is_monthly_income, tx_date, source, note)
       VALUES ($1, 'masuk', 1000000, TRUE, '2024-01-01', 'dashboard', 'TEST_DASHBOARD_IncomeP1')`,
      [pastP1.id]
    );

    // Tutup P1 via API
    const closeRes = await fetch(`${baseUrl}/api/periods/${pastP1.id}/close`, {
      method: 'POST',
      headers: { Cookie: authCookie, Origin: baseUrl },
    });
    expect(closeRes.status).toBe(200);

    // Cek main_opening P2 setelah tutup P1
    const p2Before = await pool.query('SELECT main_opening FROM periods WHERE id = $1', [pastP2.id]);
    expect(BigInt(p2Before.rows[0].main_opening)).toBe(1000000n);

    // Sekarang tambahkan pengeluaran 100.000 di P1 (periode tertutup)
    const txP1Res = await pool.query(
      `INSERT INTO transactions (period_id, type, amount, tx_date, source, note)
       VALUES ($1, 'keluar', 100000, '2024-01-15', 'dashboard', 'TEST_DASHBOARD_Retroactive')
       RETURNING id`,
      [pastP1.id]
    );

    // Jalankan recompute berantai via API POST /api/periods/:id/recompute
    const recompRes = await fetch(`${baseUrl}/api/periods/${pastP1.id}/recompute`, {
      method: 'POST',
      headers: { Cookie: authCookie, Origin: baseUrl },
    });
    expect(recompRes.status).toBe(200);
    const recompBody = await recompRes.json();
    expect(recompBody.ok).toBe(true);

    // Verifikasi main_opening P2 sekarang berubah menjadi 900.000 (1.000.000 - 100.000)
    const p2After = await pool.query('SELECT main_opening FROM periods WHERE id = $1', [pastP2.id]);
    expect(BigInt(p2After.rows[0].main_opening)).toBe(900000n);
  });
});

