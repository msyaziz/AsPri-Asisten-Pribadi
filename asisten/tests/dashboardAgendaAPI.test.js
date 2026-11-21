import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/api/server.js';
import { pool } from '../src/db/pool.js';
import { createAdmin } from '../scripts/create-admin.js';

describe('Checkpoint D — API Agenda, Kategori, Bot, Log, dan Settings', () => {
  let server;
  let baseUrl;
  let authCookie;
  const testEmail = `test_admin_agenda_${Date.now()}@example.com`;
  const testPassword = 'PasswordAgenda123!';

  beforeAll(async () => {
    // 1. Bersihkan sisa data uji terdahulu
    await pool.query("DELETE FROM events WHERE title LIKE 'TEST_AGENDA_%'");
    await pool.query("DELETE FROM notes WHERE content LIKE 'TEST_NOTE_%'");
    await pool.query("DELETE FROM category_rules WHERE keyword LIKE 'test_kw_%'");
    await pool.query("DELETE FROM categories WHERE name LIKE 'TEST_CAT_%'");

    // 2. Buat akun admin uji
    await createAdmin(testEmail, testPassword);

    // 3. Jalankan server di port acak (0)
    const app = createServer();
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // 4. Login untuk mendapatkan auth cookie
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
    // Bersihkan data uji
    await pool.query('DELETE FROM admin_users WHERE email = $1', [testEmail]);
    await pool.query("DELETE FROM events WHERE title LIKE 'TEST_AGENDA_%'");
    await pool.query("DELETE FROM notes WHERE content LIKE 'TEST_NOTE_%'");
    await pool.query("DELETE FROM category_rules WHERE keyword LIKE 'test_kw_%'");
    await pool.query("DELETE FROM categories WHERE name LIKE 'TEST_CAT_%'");
  });

  it('1. Semua endpoint agenda/bot/log/settings menolak akses tanpa login (401)', async () => {
    const endpoints = [
      '/api/events',
      '/api/notes',
      '/api/categories',
      '/api/category-rules',
      '/api/bot/status',
      '/api/bot/qr',
      '/api/action-log',
      '/api/ai-usage',
      '/api/pending',
      '/api/settings',
    ];

    for (const ep of endpoints) {
      const res = await fetch(`${baseUrl}${ep}`);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    }
  });

  it('2. Events & Tasks: CRUD, complete task, soft-delete, dan restore', async () => {
    // 2.1 Tambah Event
    const eventRes = await fetch(`${baseUrl}/api/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie,
        Origin: baseUrl,
      },
      body: JSON.stringify({
        kind: 'event',
        title: 'TEST_AGENDA_Rapat Tim',
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        description: 'Pembahasan proyek v2',
      }),
    });
    expect(eventRes.status).toBe(200);
    const eventBody = await eventRes.json();
    expect(eventBody.ok).toBe(true);
    expect(eventBody.data.title).toBe('TEST_AGENDA_Rapat Tim');
    const eventId = eventBody.data.id;

    // 2.2 Tambah Task
    const taskRes = await fetch(`${baseUrl}/api/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie,
        Origin: baseUrl,
      },
      body: JSON.stringify({
        kind: 'task',
        title: 'TEST_AGENDA_Beli Kopi',
        startsAt: new Date(Date.now() + 3600000).toISOString(),
      }),
    });
    expect(taskRes.status).toBe(200);
    const taskBody = await taskRes.json();
    expect(taskBody.ok).toBe(true);
    const taskId = taskBody.data.id;

    // 2.3 List events
    const listRes = await fetch(`${baseUrl}/api/events?kind=task`, {
      headers: { Cookie: authCookie },
    });
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.ok).toBe(true);
    expect(listBody.data.some((e) => e.id === taskId)).toBe(true);

    // 2.4 Selesaikan Task
    const completeRes = await fetch(`${baseUrl}/api/events/${taskId}/complete`, {
      method: 'POST',
      headers: { Cookie: authCookie, Origin: baseUrl },
    });
    expect(completeRes.status).toBe(200);
    const completeBody = await completeRes.json();
    expect(completeBody.data.status).toBe('done');

    // 2.5 Update Event
    const patchRes = await fetch(`${baseUrl}/api/events/${eventId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie,
        Origin: baseUrl,
      },
      body: JSON.stringify({
        title: 'TEST_AGENDA_Rapat Tim Diubah',
      }),
    });
    expect(patchRes.status).toBe(200);
    const patchBody = await patchRes.json();
    expect(patchBody.data.title).toBe('TEST_AGENDA_Rapat Tim Diubah');

    // 2.6 Soft delete event
    const delRes = await fetch(`${baseUrl}/api/events/${eventId}`, {
      method: 'DELETE',
      headers: { Cookie: authCookie, Origin: baseUrl },
    });
    expect(delRes.status).toBe(200);

    // Pastikan tidak muncul di list biasa
    const listAfterDel = await fetch(`${baseUrl}/api/events`, {
      headers: { Cookie: authCookie },
    });
    const listAfterDelBody = await listAfterDel.json();
    expect(listAfterDelBody.data.some((e) => e.id === eventId)).toBe(false);

    // 2.7 Restore event
    const restoreRes = await fetch(`${baseUrl}/api/events/${eventId}/restore`, {
      method: 'POST',
      headers: { Cookie: authCookie, Origin: baseUrl },
    });
    expect(restoreRes.status).toBe(200);
    const restoreBody = await restoreRes.json();
    expect(restoreBody.data.deleted_at).toBeNull();
  });

  it('3. Notes: CRUD, pencarian q, soft delete, dan restore', async () => {
    // 3.1 Tambah catatan
    const postRes = await fetch(`${baseUrl}/api/notes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie,
        Origin: baseUrl,
      },
      body: JSON.stringify({
        content: 'TEST_NOTE_Ide fitur baru asisten cerdas',
        tags: ['ide', 'fitur'],
      }),
    });
    expect(postRes.status).toBe(200);
    const postBody = await postRes.json();
    expect(postBody.ok).toBe(true);
    const noteId = postBody.data.id;

    // 3.2 List & pencarian catatan
    const searchRes = await fetch(`${baseUrl}/api/notes?q=asisten`, {
      headers: { Cookie: authCookie },
    });
    expect(searchRes.status).toBe(200);
    const searchBody = await searchRes.json();
    expect(searchBody.ok).toBe(true);
    expect(searchBody.data.some((n) => n.id === noteId)).toBe(true);

    // 3.3 Update catatan
    const patchRes = await fetch(`${baseUrl}/api/notes/${noteId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie,
        Origin: baseUrl,
      },
      body: JSON.stringify({
        content: 'TEST_NOTE_Ide fitur baru asisten cerdas revisi',
      }),
    });
    expect(patchRes.status).toBe(200);
    const patchBody = await patchRes.json();
    expect(patchBody.data.content).toBe('TEST_NOTE_Ide fitur baru asisten cerdas revisi');

    // 3.4 Soft delete
    const delRes = await fetch(`${baseUrl}/api/notes/${noteId}`, {
      method: 'DELETE',
      headers: { Cookie: authCookie, Origin: baseUrl },
    });
    expect(delRes.status).toBe(200);

    // 3.5 Restore
    const restoreRes = await fetch(`${baseUrl}/api/notes/${noteId}/restore`, {
      method: 'POST',
      headers: { Cookie: authCookie, Origin: baseUrl },
    });
    expect(restoreRes.status).toBe(200);
    const restoreBody = await restoreRes.json();
    expect(restoreBody.data.deleted_at).toBeNull();
  });

  it('4. Categories & Category Rules: CRUD kategori dan aturan kata kunci', async () => {
    // 4.1 Tambah Kategori
    const catRes = await fetch(`${baseUrl}/api/categories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie,
        Origin: baseUrl,
      },
      body: JSON.stringify({
        name: 'TEST_CAT_Langganan',
        type: 'keluar',
      }),
    });
    expect(catRes.status).toBe(200);
    const catBody = await catRes.json();
    expect(catBody.ok).toBe(true);
    const catId = catBody.data.id;

    // 4.2 Update Kategori
    const patchCatRes = await fetch(`${baseUrl}/api/categories/${catId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie,
        Origin: baseUrl,
      },
      body: JSON.stringify({
        name: 'TEST_CAT_Langganan_Updated',
      }),
    });
    expect(patchCatRes.status).toBe(200);
    const patchCatBody = await patchCatRes.json();
    expect(patchCatBody.data.name).toBe('TEST_CAT_Langganan_Updated');

    // 4.3 Tambah Aturan Kategori
    const ruleRes = await fetch(`${baseUrl}/api/category-rules`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie,
        Origin: baseUrl,
      },
      body: JSON.stringify({
        keyword: 'test_kw_netflix',
        categoryId: catId,
        source: 'seed',
      }),
    });
    expect(ruleRes.status).toBe(200);
    const ruleBody = await ruleRes.json();
    expect(ruleBody.ok).toBe(true);
    const ruleId = ruleBody.data.id;

    // 4.4 List Rules
    const listRulesRes = await fetch(`${baseUrl}/api/category-rules?categoryId=${catId}`, {
      headers: { Cookie: authCookie },
    });
    expect(listRulesRes.status).toBe(200);
    const listRulesBody = await listRulesRes.json();
    expect(listRulesBody.data.some((r) => r.id === ruleId)).toBe(true);

    // 4.5 Delete Rule
    const delRuleRes = await fetch(`${baseUrl}/api/category-rules/${ruleId}`, {
      method: 'DELETE',
      headers: { Cookie: authCookie, Origin: baseUrl },
    });
    expect(delRuleRes.status).toBe(200);

    // 4.6 Delete Category
    const delCatRes = await fetch(`${baseUrl}/api/categories/${catId}`, {
      method: 'DELETE',
      headers: { Cookie: authCookie, Origin: baseUrl },
    });
    expect(delCatRes.status).toBe(200);
  });

  it('5. Bot API: status, proteksi QR (404 bila tidak pairing), dan restart', async () => {
    // 5.1 Status Bot
    const statusRes = await fetch(`${baseUrl}/api/bot/status`, {
      headers: { Cookie: authCookie },
    });
    expect(statusRes.status).toBe(200);
    const statusBody = await statusRes.json();
    expect(statusBody.ok).toBe(true);
    expect(statusBody.data).toHaveProperty('state');
    expect(statusBody.data).toHaveProperty('droppedCount');

    // 5.2 QR Bot (Harus 404 jika bot belum dalam sesi pairing qr_ready)
    const qrRes = await fetch(`${baseUrl}/api/bot/qr`, {
      headers: { Cookie: authCookie },
    });
    if (statusBody.data.state !== 'qr_ready') {
      expect(qrRes.status).toBe(404);
      const qrBody = await qrRes.json();
      expect(qrBody.ok).toBe(false);
      expect(qrBody.error.code).toBe('QR_NOT_READY');
    }

    // 5.3 Restart Bot
    const restartRes = await fetch(`${baseUrl}/api/bot/restart`, {
      method: 'POST',
      headers: { Cookie: authCookie, Origin: baseUrl },
    });
    expect(restartRes.status).toBe(200);
    const restartBody = await restartRes.json();
    expect(restartBody.ok).toBe(true);
  });

  it('6. Logs & Pending Actions API: action-log, ai-usage, pending', async () => {
    // 6.1 Action Log
    const logRes = await fetch(`${baseUrl}/api/action-log?limit=10`, {
      headers: { Cookie: authCookie },
    });
    expect(logRes.status).toBe(200);
    const logBody = await logRes.json();
    expect(logBody.ok).toBe(true);
    expect(Array.isArray(logBody.data)).toBe(true);

    // 6.2 AI Usage
    const usageRes = await fetch(`${baseUrl}/api/ai-usage?days=7`, {
      headers: { Cookie: authCookie },
    });
    expect(usageRes.status).toBe(200);
    const usageBody = await usageRes.json();
    expect(usageBody.ok).toBe(true);
    expect(usageBody.data).toHaveProperty('summary');
    expect(usageBody.data).toHaveProperty('logs');

    // 6.3 Pending Actions
    const pendingRes = await fetch(`${baseUrl}/api/pending`, {
      headers: { Cookie: authCookie },
    });
    expect(pendingRes.status).toBe(200);
    const pendingBody = await pendingRes.json();
    expect(pendingBody.ok).toBe(true);
    expect(Array.isArray(pendingBody.data)).toBe(true);
  });

  it('7. Settings API: read dan update konfigurasi sistem', async () => {
    // 7.1 Baca settings
    const getRes = await fetch(`${baseUrl}/api/settings`, {
      headers: { Cookie: authCookie },
    });
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.ok).toBe(true);
    expect(getBody.data).toHaveProperty('settings');

    // 7.2 Update settings
    const updateRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie,
        Origin: baseUrl,
      },
      body: JSON.stringify({
        test_setting_key: 'test_value_123',
      }),
    });
    expect(updateRes.status).toBe(200);
    const updateBody = await updateRes.json();
    expect(updateBody.ok).toBe(true);
    expect(updateBody.data.test_setting_key).toBe('test_value_123');

    // Bersihkan setting uji
    await pool.query("DELETE FROM settings WHERE key = 'test_setting_key'");
  });
});
