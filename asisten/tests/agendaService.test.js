/**
 * Test service events & notes (Checkpoint B – Fase 4)
 * Membutuhkan koneksi DB aktif.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../src/db/pool.js';
import { addEvent, completeTask, listEvents } from '../src/services/events.js';
import { addNote, searchNotes, deleteNote, listNotes } from '../src/services/notes.js';
import { getLastUndoableAction, undoAction } from '../src/services/undo.js';
import { handleRegexCommand } from '../src/bot/regexCommands.js';

async function cleanAgenda() {
  await pool.query('DELETE FROM reminders');
  await pool.query("DELETE FROM events WHERE title LIKE 'TEST_%'");
  await pool.query("DELETE FROM notes WHERE content LIKE 'TEST_%'");
}

beforeAll(async () => {
  await cleanAgenda();
});

afterAll(async () => {
  await cleanAgenda();
  await pool.end();
});

describe('Service: events', () => {
  it('addEvent – event berhasil dibuat dan reminders ter-generate', async () => {
    const startsAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const id = await addEvent({
      kind: 'event',
      title: 'TEST_Meeting Klien',
      startsAt,
      remindOffsets: [60, 30],
    });
    expect(typeof id).toBe('number');

    // Verifikasi event ada
    const ev = await pool.query('SELECT * FROM events WHERE id = $1', [id]);
    expect(ev.rows[0].title).toBe('TEST_Meeting Klien');
    expect(ev.rows[0].status).toBe('open');

    // Verifikasi reminders terbuat
    const rem = await pool.query('SELECT * FROM reminders WHERE event_id = $1 ORDER BY offset_minutes', [id]);
    expect(rem.rowCount).toBe(2);
    expect(rem.rows[0].offset_minutes).toBe(30);
    expect(rem.rows[1].offset_minutes).toBe(60);
    expect(rem.rows[0].sent_at).toBeNull();
  });

  it('addEvent – task berhasil dibuat', async () => {
    const id = await addEvent({
      kind: 'task',
      title: 'TEST_Beli groceries',
      startsAt: new Date().toISOString(),
      remindOffsets: [],
    });
    expect(id).toBeGreaterThan(0);
    const ev = await pool.query('SELECT kind FROM events WHERE id = $1', [id]);
    expect(ev.rows[0].kind).toBe('task');
  });

  it('addEvent – validasi Zod gagal untuk kind tidak valid', async () => {
    await expect(addEvent({
      kind: 'invalid',
      title: 'TEST_Invalid',
      startsAt: new Date().toISOString(),
    })).rejects.toThrow();
  });

  it('completeTask – menandai task selesai dan hapus reminders', async () => {
    const id = await addEvent({
      kind: 'task',
      title: 'TEST_Tugas selesai',
      startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      remindOffsets: [30],
    });
    await completeTask(id);
    const ev = await pool.query('SELECT status FROM events WHERE id = $1', [id]);
    expect(ev.rows[0].status).toBe('done');
    const rem = await pool.query('SELECT * FROM reminders WHERE event_id = $1', [id]);
    expect(rem.rowCount).toBe(0);
  });

  it('completeTask – gagal untuk event (bukan task)', async () => {
    const id = await addEvent({
      kind: 'event',
      title: 'TEST_Event biasa',
      startsAt: new Date().toISOString(),
      remindOffsets: [],
    });
    await expect(completeTask(id)).rejects.toThrow('Hanya task');
  });

  it('listEvents – filter berdasarkan kind', async () => {
    const rows = await listEvents({ kind: 'task' });
    for (const row of rows) {
      expect(row.kind).toBe('task');
    }
  });

  it('listEvents – filter berdasarkan status', async () => {
    const rows = await listEvents({ status: 'open' });
    for (const row of rows) {
      expect(row.status).toBe('open');
    }
  });
});

describe('Service: notes', () => {
  it('addNote – berhasil menyimpan catatan', async () => {
    const id = await addNote({
      content: 'TEST_Password wifi: abc123',
      tags: ['wifi', 'password'],
    });
    expect(typeof id).toBe('number');
    const note = await pool.query('SELECT * FROM notes WHERE id = $1', [id]);
    expect(note.rows[0].content).toBe('TEST_Password wifi: abc123');
    expect(note.rows[0].tags).toContain('wifi');
  });

  it('searchNotes – menemukan catatan berdasarkan kata kunci', async () => {
    await addNote({ content: 'TEST_Reminder servis motor Honda setiap 3 bulan' });
    const results = await searchNotes('motor Honda');
    const found = results.some((r) => r.content.includes('motor Honda'));
    expect(found).toBe(true);
  });

  it('deleteNote – soft delete berhasil', async () => {
    const id = await addNote({ content: 'TEST_Catatan untuk dihapus' });
    await deleteNote(id);
    const note = await pool.query('SELECT deleted_at FROM notes WHERE id = $1', [id]);
    expect(note.rows[0].deleted_at).not.toBeNull();
  });

  it('deleteNote – melempar error jika tidak ditemukan', async () => {
    await expect(deleteNote(999999999)).rejects.toThrow();
  });

  it('listNotes – tidak menampilkan catatan yang sudah dihapus', async () => {
    const id = await addNote({ content: 'TEST_Dihapus_cek list' });
    await deleteNote(id);
    const rows = await listNotes();
    const found = rows.some((r) => r.id === id);
    expect(found).toBe(false);
  });
});

describe('Undo: Events & Notes', () => {
  it('undo create event – soft delete event dan hapus reminders', async () => {
    const startsAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    const id = await addEvent({
      kind: 'event',
      title: 'TEST_Acara untuk di-undo',
      startsAt,
      remindOffsets: [60],
    });

    const lastAction = await getLastUndoableAction();
    expect(lastAction.entity).toBe('event');
    expect(lastAction.action).toBe('create');
    expect(Number(lastAction.entity_id)).toBe(id);

    const undoRes = await undoAction(lastAction.id);
    expect(undoRes.success).toBe(true);

    const ev = await pool.query('SELECT deleted_at FROM events WHERE id = $1', [id]);
    expect(ev.rows[0].deleted_at).not.toBeNull();

    const rem = await pool.query('SELECT * FROM reminders WHERE event_id = $1', [id]);
    expect(rem.rowCount).toBe(0);
  });

  it('undo completeTask – pulihkan status tugas kembali ke open', async () => {
    const id = await addEvent({
      kind: 'task',
      title: 'TEST_Tugas selesai lalu undo',
      startsAt: new Date().toISOString(),
      remindOffsets: [],
    });
    await completeTask(id);

    const lastAction = await getLastUndoableAction();
    expect(lastAction.entity).toBe('event');
    expect(lastAction.action).toBe('update');

    const undoRes = await undoAction(lastAction.id);
    expect(undoRes.success).toBe(true);

    const ev = await pool.query('SELECT status FROM events WHERE id = $1', [id]);
    expect(ev.rows[0].status).toBe('open');
  });

  it('undo create note – soft delete catatan', async () => {
    const id = await addNote({ content: 'TEST_Catatan rahasia batal' });

    const lastAction = await getLastUndoableAction();
    expect(lastAction.entity).toBe('note');
    expect(lastAction.action).toBe('create');

    const undoRes = await undoAction(lastAction.id);
    expect(undoRes.success).toBe(true);

    const note = await pool.query('SELECT deleted_at FROM notes WHERE id = $1', [id]);
    expect(note.rows[0].deleted_at).not.toBeNull();
  });
});

describe('Regex Commands: jadwal & hari ini (Langkah 6)', () => {
  it('perintah "jadwal" merespons daftar agenda tanpa AI', async () => {
    await addEvent({
      kind: 'event',
      title: 'TEST_Workshop Node.js',
      startsAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    });

    const reply = await handleRegexCommand('jadwal');
    expect(reply).not.toBeNull();
    expect(reply).toContain('TEST_Workshop Node.js');
  });

  it('perintah "hari ini" merespons ringkasan hari ini tanpa AI', async () => {
    const reply = await handleRegexCommand('hari ini');
    expect(reply).not.toBeNull();
    expect(reply).toContain('Ringkasan Hari Ini');
    expect(reply).toContain('Pengeluaran Hari Ini');
  });

  it('perintah "batal" membatalkan aksi agenda lewat regex', async () => {
    await addNote({ content: 'TEST_Catatan cepat batal via regex' });
    const reply = await handleRegexCommand('batal');
    expect(reply).toContain('Catatan berhasil dibatalkan');
  });
});
