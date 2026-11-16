/**
 * Test Checkpoint A — Migrasi Database 0003_agenda.sql
 * Sesuai prd.md §8.11, §9.3 dan 04-fase4-agenda.md
 */

import { describe, it, expect, afterAll } from 'vitest';
import { pool } from '../src/db/pool.js';

describe('Checkpoint A — Migrasi Database 0003_agenda.sql', () => {
  afterAll(async () => {
    // Cleanup data test jika ada
    await pool.query("DELETE FROM events WHERE title LIKE 'TEST_MIGRATION_%'");
    await pool.query("DELETE FROM notes WHERE content LIKE 'TEST_MIGRATION_%'");
    await pool.end();
  });

  it('tabel events, reminders, dan notes terdaftar di database', async () => {
    const res = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('events', 'reminders', 'notes')
      ORDER BY table_name;
    `);

    const tableNames = res.rows.map((r) => r.table_name);
    expect(tableNames).toEqual(['events', 'notes', 'reminders']);
  });

  it('tabel events mendukung event dan task dengan check constraint', async () => {
    // 1. Insert valid event
    const eventRes = await pool.query(
      `INSERT INTO events (kind, title, starts_at, remind_offsets)
       VALUES ('event', 'TEST_MIGRATION_Rapat', '2026-12-01 10:00:00+07', '{1440,60}')
       RETURNING id, kind, status, remind_offsets`,
      []
    );
    expect(eventRes.rows[0].kind).toBe('event');
    expect(eventRes.rows[0].status).toBe('open');
    expect(eventRes.rows[0].remind_offsets).toEqual([1440, 60]);

    // 2. Insert valid task
    const taskRes = await pool.query(
      `INSERT INTO events (kind, title, starts_at)
       VALUES ('task', 'TEST_MIGRATION_Laporan', '2026-12-05 17:00:00+07')
       RETURNING id, kind, status`,
      []
    );
    expect(taskRes.rows[0].kind).toBe('task');
    expect(taskRes.rows[0].status).toBe('open');

    // 3. Invalid kind harus ditolak
    await expect(
      pool.query(
        `INSERT INTO events (kind, title, starts_at)
         VALUES ('invalid_kind', 'TEST_MIGRATION_Fail', now())`
      )
    ).rejects.toThrow();

    // 4. Invalid status harus ditolak
    await expect(
      pool.query(
        `INSERT INTO events (kind, title, starts_at, status)
         VALUES ('event', 'TEST_MIGRATION_Fail', now(), 'invalid_status')`
      )
    ).rejects.toThrow();
  });

  it('tabel reminders memiliki foreign key cascade ke events dan constraint unique', async () => {
    const eventRes = await pool.query(
      `INSERT INTO events (kind, title, starts_at)
       VALUES ('event', 'TEST_MIGRATION_Seminar', '2026-12-10 09:00:00+07')
       RETURNING id`,
      []
    );
    const eventId = eventRes.rows[0].id;

    // Insert reminder
    const remindAt = '2026-12-09 09:00:00+07';
    const remRes = await pool.query(
      `INSERT INTO reminders (event_id, remind_at)
       VALUES ($1, $2)
       RETURNING id, event_id, sent_at`,
      [eventId, remindAt]
    );
    expect(remRes.rows[0].event_id).toBe(eventId);
    expect(remRes.rows[0].sent_at).toBeNull();

    // Duplicate reminder (event_id, remind_at) harus ditolak
    await expect(
      pool.query(
        `INSERT INTO reminders (event_id, remind_at)
         VALUES ($1, $2)`,
        [eventId, remindAt]
      )
    ).rejects.toThrow();

    // Hapus event harus CASCADE menghapus reminders terkait
    await pool.query('DELETE FROM events WHERE id = $1', [eventId]);
    const remCheck = await pool.query('SELECT * FROM reminders WHERE event_id = $1', [eventId]);
    expect(remCheck.rows.length).toBe(0);
  });

  it('tabel notes mendukung penyimpanan tag dan pencarian full-text search GIN', async () => {
    const noteRes = await pool.query(
      `INSERT INTO notes (content, tags)
       VALUES ('TEST_MIGRATION_Servis rutin motor Honda Vario ganti oli mesin dan busi', '{"servis","motor"}')
       RETURNING id, content, tags, note_date`,
      []
    );
    expect(noteRes.rows[0].tags).toEqual(['servis', 'motor']);

    // Test query FTS menggunakan to_tsvector('simple', content)
    const ftsRes = await pool.query(
      `SELECT id, content 
       FROM notes 
       WHERE to_tsvector('simple', content) @@ plainto_tsquery('simple', 'oli busi')
         AND deleted_at IS NULL
         AND content LIKE 'TEST_MIGRATION_%'`,
      []
    );
    expect(ftsRes.rows.length).toBeGreaterThan(0);
    expect(ftsRes.rows[0].content).toContain('oli mesin dan busi');
  });
});

