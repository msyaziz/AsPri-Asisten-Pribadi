import { Router } from 'express';
import { z } from 'zod';
import {
  getCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
  getCategoryRules,
  upsertCategoryRule,
  updateCategoryRule,
  deleteCategoryRule,
} from '../../services/categories.js';

export const categoriesRouter = Router();
export const categoryRulesRouter = Router();

// ================= KATEGORI =================

// GET /api/categories
categoriesRouter.get('/', async (req, res) => {
  try {
    const activeOnly = req.query.activeOnly !== 'false';
    const type = req.query.type || null;
    const categories = await getCategories({ activeOnly, type });
    res.json({ ok: true, data: categories });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: { code: 'GET_CATEGORIES_FAILED', message: err.message },
    });
  }
});

const createCategorySchema = z.object({
  name: z.string().min(1, 'Nama kategori wajib diisi'),
  type: z.enum(['keluar', 'masuk', 'both']).default('keluar'),
  defaultPocketId: z.coerce.number().nullable().optional(),
});

// POST /api/categories
categoriesRouter.post('/', async (req, res) => {
  const parsed = createCategorySchema.safeParse(req.body);
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
    const category = await createCategory(parsed.data);
    res.json({ ok: true, data: category });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: { code: 'CREATE_CATEGORY_FAILED', message: err.message },
    });
  }
});

// GET /api/categories/:id
categoriesRouter.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'ID kategori tidak valid.' },
    });
  }

  try {
    const category = await getCategoryById(id);
    if (!category) {
      return res.status(404).json({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Kategori tidak ditemukan.' },
      });
    }
    res.json({ ok: true, data: category });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: { code: 'GET_CATEGORY_FAILED', message: err.message },
    });
  }
});

const updateCategorySchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(['keluar', 'masuk', 'both']).optional(),
  defaultPocketId: z.coerce.number().nullable().optional(),
  isActive: z.boolean().optional(),
});

// PATCH /api/categories/:id
categoriesRouter.patch('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'ID kategori tidak valid.' },
    });
  }

  const parsed = updateCategorySchema.safeParse(req.body);
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
    const updated = await updateCategory(id, parsed.data);
    res.json({ ok: true, data: updated });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: { code: 'UPDATE_CATEGORY_FAILED', message: err.message },
    });
  }
});

// DELETE /api/categories/:id
categoriesRouter.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'ID kategori tidak valid.' },
    });
  }

  try {
    const deleted = await deleteCategory(id);
    res.json({ ok: true, data: deleted });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: { code: 'DELETE_CATEGORY_FAILED', message: err.message },
    });
  }
});

// ================= CATEGORY RULES =================

// GET /api/category-rules
categoryRulesRouter.get('/', async (req, res) => {
  try {
    const categoryId = req.query.categoryId ? Number(req.query.categoryId) : null;
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const rules = await getCategoryRules({ categoryId, limit });
    res.json({ ok: true, data: rules });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: { code: 'GET_CATEGORY_RULES_FAILED', message: err.message },
    });
  }
});

const createRuleSchema = z.object({
  keyword: z.string().min(1, 'Keyword wajib diisi'),
  categoryId: z.coerce.number({ required_error: 'ID kategori wajib diisi' }),
  source: z.enum(['seed', 'koreksi', 'ai']).optional().default('koreksi'),
});

// POST /api/category-rules
categoryRulesRouter.post('/', async (req, res) => {
  const parsed = createRuleSchema.safeParse(req.body);
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
    const rule = await upsertCategoryRule(parsed.data);
    res.json({ ok: true, data: rule });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: { code: 'CREATE_CATEGORY_RULE_FAILED', message: err.message },
    });
  }
});

const updateRuleSchema = z.object({
  keyword: z.string().min(1).optional(),
  categoryId: z.coerce.number().optional(),
});

// PATCH /api/category-rules/:id
categoryRulesRouter.patch('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'ID aturan tidak valid.' },
    });
  }

  const parsed = updateRuleSchema.safeParse(req.body);
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
    const updated = await updateCategoryRule(id, parsed.data);
    res.json({ ok: true, data: updated });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: { code: 'UPDATE_CATEGORY_RULE_FAILED', message: err.message },
    });
  }
});

// DELETE /api/category-rules/:id
categoryRulesRouter.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'ID aturan tidak valid.' },
    });
  }

  try {
    const deleted = await deleteCategoryRule(id);
    res.json({ ok: true, data: deleted });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: { code: 'DELETE_CATEGORY_RULE_FAILED', message: err.message },
    });
  }
});

export default categoriesRouter;
