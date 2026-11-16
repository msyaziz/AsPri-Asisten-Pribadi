/**
 * Test AI Intent & Tools untuk Agenda (Checkpoint D – Fase 4)
 * prd.md §8.11, §12, 04-fase4-agenda.md
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../src/db/pool.js';
import { understandMessage } from '../src/ai/understand.js';
import { executeTool } from '../src/tools/index.js';

beforeAll(async () => {
  await pool.query('DELETE FROM reminders');
  await pool.query("DELETE FROM events WHERE title LIKE 'TEST_AI_%'");
  await pool.query("DELETE FROM notes WHERE content LIKE 'TEST_AI_%'");
});

afterAll(async () => {
  await pool.query('DELETE FROM reminders');
  await pool.query("DELETE FROM events WHERE title LIKE 'TEST_AI_%'");
  await pool.query("DELETE FROM notes WHERE content LIKE 'TEST_AI_%'");
  await pool.end();
});

describe('Checkpoint D: Intent Pemahaman Kalimat Agenda', () => {
  it('kasus 1: "rapat jam 14 besok" -> tambah_jadwal (add_event)', async () => {
    const res = await understandMessage('rapat jam 14 besok');
    expect(res.intent).toBe('tambah_jadwal');
    expect(res.actions.length).toBe(1);
    expect(res.actions[0].tool).toBe('add_event');
    expect(res.actions[0].args.title).toContain('rapat');
    expect(res.actions[0].args.starts_at).toBeDefined();
  });

  it('kasus 2: "tugas laporan deadline jumat" -> tambah_jadwal (task)', async () => {
    const res = await understandMessage('tugas laporan deadline jumat');
    expect(res.intent).toBe('tambah_jadwal');
    expect(res.actions.length).toBe(1);
    expect(res.actions[0].tool).toBe('add_event');
    expect(res.actions[0].args.kind).toBe('task');
    expect(res.actions[0].args.title).toContain('laporan');
  });

  it('kasus 3: "tiap senin olahraga jam 6" -> tambah_jadwal berulang (recurrence weekly:MON)', async () => {
    const res = await understandMessage('tiap senin olahraga jam 6');
    expect(res.intent).toBe('tambah_jadwal');
    expect(res.actions.length).toBe(1);
    expect(res.actions[0].tool).toBe('add_event');
    expect(res.actions[0].args.recurrence).toBe('weekly:MON');
  });

  it('kasus 4: "tugas laporan selesai" -> selesai_tugas (complete_task)', async () => {
    const res = await understandMessage('tugas laporan selesai');
    expect(res.intent).toBe('selesai_tugas');
    expect(res.actions.length).toBe(1);
    expect(res.actions[0].tool).toBe('complete_task');
    expect(res.actions[0].args.title).toContain('laporan');
  });

  it('kasus 5: "cari catatan servis motor" -> tanya_data (search_notes)', async () => {
    const res = await understandMessage('cari catatan servis motor');
    expect(res.intent).toBe('tanya_data');
    expect(res.actions.length).toBe(1);
    expect(res.actions[0].tool).toBe('search_notes');
    expect(res.actions[0].args.keyword).toContain('servis motor');
  });

  it('kasus catatan: "catat: password wifi rumah adalah 12345" -> catat_note (add_note)', async () => {
    const res = await understandMessage('catat: password wifi rumah adalah 12345');
    expect(res.intent).toBe('catat_note');
    expect(res.actions.length).toBe(1);
    expect(res.actions[0].tool).toBe('add_note');
    expect(res.actions[0].args.content).toContain('password wifi');
  });
});

describe('Checkpoint D: Eksekusi Tool Agenda (executeTool)', () => {
  it('eksekusi add_event berhasil dan mengembalikan pesan konfirmasi', async () => {
    const action = {
      tool: 'add_event',
      args: {
        kind: 'event',
        title: 'TEST_AI_Diskusi Proyek',
        starts_at: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
        recurrence: 'daily',
      },
    };

    const res = await executeTool(action, { messageText: 'buat jadwal diskusi proyek' });
    expect(res.status).toBe('executed');
    expect(res.reply).toContain('Jadwal Berhasil Ditambahkan');
    expect(res.reply).toContain('TEST_AI_Diskusi Proyek');
    expect(res.reply).toContain('Berulang: daily');
    expect(res.data.id).toBeDefined();
  });

  it('eksekusi complete_task berhasil menandai task selesai', async () => {
    // 1. Buat task dulu
    const insertRes = await pool.query(
      `INSERT INTO events (kind, title, starts_at, status)
       VALUES ('task', 'TEST_AI_Beli token listrik', now() + interval '2 hours', 'open')
       RETURNING id`
    );
    const taskId = insertRes.rows[0].id;

    // 2. Eksekusi complete_task
    const action = {
      tool: 'complete_task',
      args: {
        event_id: Number(taskId),
      },
    };

    const res = await executeTool(action, { messageText: 'selesai tugas beli token listrik' });
    expect(res.status).toBe('executed');
    expect(res.reply).toContain('ditandai selesai');

    // 3. Verifikasi status di DB
    const ev = await pool.query('SELECT status FROM events WHERE id = $1', [taskId]);
    expect(ev.rows[0].status).toBe('done');
  });

  it('eksekusi add_note berhasil menyimpan catatan dan mengembalikan respons', async () => {
    const action = {
      tool: 'add_note',
      args: {
        content: 'TEST_AI_Nomor rekening listrik: 123456789',
        tags: ['listrik'],
      },
    };

    const res = await executeTool(action, { messageText: 'catat rekening listrik' });
    expect(res.status).toBe('executed');
    expect(res.reply).toContain('Catatan Disimpan');
    expect(res.data.id).toBeDefined();

    const note = await pool.query('SELECT * FROM notes WHERE id = $1', [res.data.id]);
    expect(note.rows[0].content).toContain('123456789');
  });

  it('eksekusi search_notes mencari dan merespons hasil', async () => {
    // Note sudah dimasukkan dari test sebelumnya
    const action = {
      tool: 'search_notes',
      args: {
        keyword: 'listrik',
      },
    };

    const res = await executeTool(action, { messageText: 'cari catatan listrik' });
    expect(res.status).toBe('executed');
    expect(res.data.length).toBeGreaterThanOrEqual(1);
  });
});

