/**
 * Test Scheduler Jobs untuk Agenda (Checkpoint C & E – Fase 4)
 * Mencakup: reminders, pending_expire, daily_briefing, weekly_report, expand_recurrence, initJobs/stopJobs.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { pool } from '../src/db/pool.js';
import * as senderModule from '../src/bot/sender.js';
import { runReminderJob } from '../src/jobs/reminders.js';
import { runDailyBriefing, runWeeklyReport } from '../src/jobs/briefing.js';
import { expandRecurrences } from '../src/services/events.js';
import { expirePendingActions, createPendingAction } from '../src/services/pendingActions.js';
import { initJobs, stopJobs } from '../src/jobs/index.js';

import env from '../src/config/env.js';

const sentMessages = [];
let originalWhitelistJid = null;

beforeAll(async () => {
  vi.spyOn(senderModule, 'sendText').mockImplementation(async (jid, text) => {
    sentMessages.push({ jid, text });
    return { key: { id: `mock_${Date.now()}` } };
  });

  const prev = await pool.query("SELECT value FROM settings WHERE key = 'whitelist_jid'");
  originalWhitelistJid = prev.rows[0]?.value;

  const testJid = env.WHITELIST_JID || '6285642060441@s.whatsapp.net';
  await pool.query(
    `INSERT INTO settings (key, value)
     VALUES ('whitelist_jid', $1)
     ON CONFLICT (key) DO UPDATE SET value = $1`,
    [JSON.stringify(testJid)]
  );
});

afterAll(async () => {
  stopJobs();
  if (originalWhitelistJid !== null && originalWhitelistJid !== undefined) {
    await pool.query(
      `UPDATE settings SET value = $1 WHERE key = 'whitelist_jid'`,
      [JSON.stringify(originalWhitelistJid)]
    );
  }
  await pool.query('DELETE FROM reminders');
  await pool.query("DELETE FROM events WHERE title LIKE 'TEST_JOB_%'");
  await pool.query("DELETE FROM pending_actions WHERE type LIKE 'test_job_%'");
  await pool.end();
});

beforeEach(() => {
  sentMessages.length = 0;
});

describe('Checkpoint C: Job reminders & pending_expire', () => {
  it('runReminderJob – mengirim pengingat yang jatuh tempo dan mencatat sent_at', async () => {
    // 1. Buat event yang starts_at 30 menit ke depan
    const eventRes = await pool.query(
      `INSERT INTO events (kind, title, starts_at)
       VALUES ('event', 'TEST_JOB_Dokter Gigi', now() + interval '30 minutes')
       RETURNING id, starts_at`
    );
    const eventId = eventRes.rows[0].id;

    // 2. Buat reminder yang jatuh tempo sekarang (remind_at = now() - interval '1 minute')
    const remRes = await pool.query(
      `INSERT INTO reminders (event_id, remind_at, offset_minutes)
       VALUES ($1, now() - interval '1 minute', 60)
       RETURNING id`,
      [eventId]
    );
    const reminderId = remRes.rows[0].id;

    // 3. Jalankan job
    await runReminderJob('628123456789@s.whatsapp.net');

    // 4. Verifikasi pesan terkirim
    expect(sentMessages.length).toBeGreaterThanOrEqual(1);
    const foundMsg = sentMessages.find((m) => m.text.includes('TEST_JOB_Dokter Gigi'));
    expect(foundMsg).toBeDefined();
    expect(foundMsg.text).toContain('Pengingat 📅 Event');
    expect(foundMsg.text).toContain('1 jam lagi');

    // 5. Verifikasi sent_at terisi di database
    const checkRem = await pool.query('SELECT sent_at FROM reminders WHERE id = $1', [reminderId]);
    expect(checkRem.rows[0].sent_at).not.toBeNull();

    // 6. Idempotensi: jalankan lagi, tidak boleh ada pesan duplikat
    sentMessages.length = 0;
    await runReminderJob('628123456789@s.whatsapp.net');
    const duplicate = sentMessages.find((m) => m.text.includes('TEST_JOB_Dokter Gigi'));
    expect(duplicate).toBeUndefined();
  });

  it('runReminderJob – tidak mengirim pengingat jika event sudah selesai (status = done)', async () => {
    const eventRes = await pool.query(
      `INSERT INTO events (kind, title, starts_at, status)
       VALUES ('task', 'TEST_JOB_Tugas Selesai', now() + interval '10 minutes', 'done')
       RETURNING id`
    );
    const eventId = eventRes.rows[0].id;

    await pool.query(
      `INSERT INTO reminders (event_id, remind_at, offset_minutes)
       VALUES ($1, now() - interval '1 minute', 30)`,
      [eventId]
    );

    await runReminderJob('628123456789@s.whatsapp.net');
    const found = sentMessages.find((m) => m.text.includes('TEST_JOB_Tugas Selesai'));
    expect(found).toBeUndefined();
  });

  it('expirePendingActions – mengubah status waiting yang kedaluwarsa menjadi expired', async () => {
    // Buat pending action yang sudah lewat waktunya
    const insertRes = await pool.query(
      `INSERT INTO pending_actions (type, payload, status, expires_at)
       VALUES ('test_job_action', '{}', 'waiting', now() - interval '1 minute')
       RETURNING id`
    );
    const paId = insertRes.rows[0].id;

    const count = await expirePendingActions();
    expect(count).toBeGreaterThanOrEqual(1);

    const check = await pool.query('SELECT status FROM pending_actions WHERE id = $1', [paId]);
    expect(check.rows[0].status).toBe('expired');
  });
});

describe('Checkpoint E: Briefing, Weekly Report, Recurrence, Lifecycle', () => {
  it('runDailyBriefing – menyusun dan mengirim ringkasan jadwal hari ini', async () => {
    // Masukkan event untuk hari ini
    await pool.query(
      `INSERT INTO events (kind, title, starts_at, status)
       VALUES ('event', 'TEST_JOB_Briefing Meeting', now() + interval '1 hour', 'open')`
    );

    await runDailyBriefing();
    expect(sentMessages.length).toBeGreaterThanOrEqual(1);
    const briefingMsg = sentMessages.find((m) => m.text.includes('Briefing Harian'));
    expect(briefingMsg).toBeDefined();
    expect(briefingMsg.text).toContain('Jadwal Hari Ini');
    expect(briefingMsg.text).toContain('TEST_JOB_Briefing Meeting');
  });

  it('runWeeklyReport – menyusun dan mengirim ringkasan mingguan 7 hari', async () => {
    await runWeeklyReport();
    expect(sentMessages.length).toBeGreaterThanOrEqual(1);
    const reportMsg = sentMessages.find((m) => m.text.includes('Laporan Mingguan'));
    expect(reportMsg).toBeDefined();
    expect(reportMsg.text).toContain('Pemasukan');
    expect(reportMsg.text).toContain('Pengeluaran');
  });

  it('expandRecurrences – meng-generate occurrence jadwal berulang', async () => {
    // Buat event daily
    const res = await pool.query(
      `INSERT INTO events (kind, title, starts_at, recurrence, status)
       VALUES ('event', 'TEST_JOB_Olahraga Harian', now(), 'daily', 'open')
       RETURNING id`
    );

    await expandRecurrences(30);

    const occurrences = await pool.query(
      "SELECT id FROM events WHERE title = 'TEST_JOB_Olahraga Harian'"
    );
    // Minimal ada 2 (original + minimal 1 yang diekspansi)
    expect(occurrences.rowCount).toBeGreaterThanOrEqual(2);
  });

  it('initJobs dan stopJobs – lifecycle scheduler berjalan tanpa error', () => {
    expect(() => initJobs()).not.toThrow();
    expect(() => stopJobs()).not.toThrow();
  });
});

