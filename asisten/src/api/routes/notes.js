import { Router } from 'express';
import { z } from 'zod';
import {
  listNotes,
  getNoteById,
  addNote,
  updateNote,
  deleteNote,
  restoreNote,
} from '../../services/notes.js';

const router = Router();

// GET /api/notes
router.get('/', async (req, res) => {
  try {
    const filter = {
      q: req.query.q,
      date: req.query.date,
      tag: req.query.tag,
      limit: req.query.limit ? Number(req.query.limit) : 50,
      offset: req.query.offset ? Number(req.query.offset) : 0,
    };
    const notes = await listNotes(filter);
    res.json({ ok: true, data: notes });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: { code: 'LIST_NOTES_FAILED', message: err.message },
    });
  }
});

const createNoteSchema = z.object({
  content: z.string().min(1, 'Isi catatan tidak boleh kosong'),
  tags: z.array(z.string()).optional(),
  noteDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD').optional(),
});

// POST /api/notes
router.post('/', async (req, res) => {
  const parsed = createNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message || 'Input tidak valid',
      },
    });
  }

  try {
    const id = await addNote(parsed.data);
    const note = await getNoteById(id);
    res.json({ ok: true, data: note });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: { code: 'CREATE_NOTE_FAILED', message: err.message },
    });
  }
});

// GET /api/notes/:id
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'ID catatan tidak valid.' },
    });
  }

  try {
    const note = await getNoteById(id);
    if (!note) {
      return res.status(404).json({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Catatan tidak ditemukan.' },
      });
    }
    res.json({ ok: true, data: note });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: { code: 'GET_NOTE_FAILED', message: err.message },
    });
  }
});

const updateNoteSchema = z.object({
  content: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
  noteDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD').optional(),
});

// PATCH /api/notes/:id
router.patch('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'ID catatan tidak valid.' },
    });
  }

  const parsed = updateNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message || 'Input tidak valid',
      },
    });
  }

  try {
    const updated = await updateNote(id, parsed.data);
    res.json({ ok: true, data: updated });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: { code: 'UPDATE_NOTE_FAILED', message: err.message },
    });
  }
});

// DELETE /api/notes/:id
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'ID catatan tidak valid.' },
    });
  }

  try {
    await deleteNote(id);
    res.json({ ok: true, data: { message: `Catatan #${id} berhasil dihapus.` } });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: { code: 'DELETE_NOTE_FAILED', message: err.message },
    });
  }
});

// POST /api/notes/:id/restore
router.post('/:id/restore', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'ID catatan tidak valid.' },
    });
  }

  try {
    const restored = await restoreNote(id);
    res.json({ ok: true, data: restored });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: { code: 'RESTORE_NOTE_FAILED', message: err.message },
    });
  }
});

export default router;
