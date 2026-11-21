import { Router } from 'express';
import { z } from 'zod';
import {
  listEvents,
  getEventById,
  addEvent,
  updateEvent,
  deleteEvent,
  restoreEvent,
  completeTask,
} from '../../services/events.js';

const router = Router();

// GET /api/events
router.get('/', async (req, res) => {
  try {
    const filter = {
      kind: req.query.kind,
      status: req.query.status,
      date: req.query.date,
      from: req.query.from,
      to: req.query.to,
      includeDeleted: req.query.deleted === 'true',
    };
    const events = await listEvents(filter);
    res.json({ ok: true, data: events });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: { code: 'LIST_EVENTS_FAILED', message: err.message },
    });
  }
});

const createEventSchema = z.object({
  kind: z.enum(['event', 'task']).default('event'),
  title: z.string().min(1, 'Judul wajib diisi'),
  startsAt: z.string().min(1, 'Waktu mulai/tenggat waktu wajib diisi'),
  endsAt: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  allDay: z.boolean().optional().default(false),
  recurrence: z.string().optional().nullable(),
  remindOffsets: z.array(z.number()).optional(),
});

// POST /api/events
router.post('/', async (req, res) => {
  const parsed = createEventSchema.safeParse(req.body);
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
    const id = await addEvent(parsed.data);
    const event = await getEventById(id);
    res.json({ ok: true, data: event });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: { code: 'CREATE_EVENT_FAILED', message: err.message },
    });
  }
});

// GET /api/events/:id
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'ID event tidak valid.' },
    });
  }

  try {
    const event = await getEventById(id);
    if (!event) {
      return res.status(404).json({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Event tidak ditemukan.' },
      });
    }
    res.json({ ok: true, data: event });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: { code: 'GET_EVENT_FAILED', message: err.message },
    });
  }
});

const updateEventSchema = z.object({
  kind: z.enum(['event', 'task']).optional(),
  title: z.string().min(1).optional(),
  startsAt: z.string().min(1).optional(),
  endsAt: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  allDay: z.boolean().optional(),
  status: z.enum(['open', 'done', 'cancelled']).optional(),
  recurrence: z.string().nullable().optional(),
});

// PATCH /api/events/:id
router.patch('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'ID event tidak valid.' },
    });
  }

  const parsed = updateEventSchema.safeParse(req.body);
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
    const updated = await updateEvent(id, parsed.data);
    res.json({ ok: true, data: updated });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: { code: 'UPDATE_EVENT_FAILED', message: err.message },
    });
  }
});

// DELETE /api/events/:id
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'ID event tidak valid.' },
    });
  }

  try {
    const deleted = await deleteEvent(id);
    res.json({ ok: true, data: deleted });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: { code: 'DELETE_EVENT_FAILED', message: err.message },
    });
  }
});

// POST /api/events/:id/restore
router.post('/:id/restore', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'ID event tidak valid.' },
    });
  }

  try {
    const restored = await restoreEvent(id);
    res.json({ ok: true, data: restored });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: { code: 'RESTORE_EVENT_FAILED', message: err.message },
    });
  }
});

// POST /api/events/:id/complete
router.post('/:id/complete', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'ID event tidak valid.' },
    });
  }

  try {
    await completeTask(id);
    const event = await getEventById(id);
    res.json({ ok: true, data: event });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: { code: 'COMPLETE_TASK_FAILED', message: err.message },
    });
  }
});

export default router;
