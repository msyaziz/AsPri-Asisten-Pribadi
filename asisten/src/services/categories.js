/**
 * Service Kategori & Category Rules (Lapis 1 Kategori Otomatis & Pembelajaran).
 * Sesuai prd.md §8.9 dan 03-fase3-ai-agent-lanjutan.md.
 */

import { pool } from '../db/pool.js';
import { logger } from '../utils/logger.js';

const STOP_WORDS = new Set([
  'di', 'ke', 'dari', 'buat', 'untuk', 'dan', 'yang', 'ini', 'itu',
  'ada', 'lagi', 'tadi', 'sama', 'beli', 'bayar', 'mau', 'akan',
  'udah', 'sudah', 'rp', 'rb', 'ribu', 'k', 'juta', 'jt', 'perak',
  'jadi', 'ubah', 'kategori', 'pada', 'oleh', 'dengan', 'saya', 'kami'
]);

/**
 * Mengambil daftar kategori.
 * @param {{ activeOnly?: boolean, type?: string }} [options]
 * @returns {Promise<Array<object>>}
 */
export async function getCategories({ activeOnly = true, type = null } = {}) {
  const conditions = [];
  const params = [];

  if (activeOnly) {
    conditions.push('c.is_active = TRUE');
  }

  if (type) {
    params.push(type);
    conditions.push(`(c.type = $${params.length} OR c.type = 'both')`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const query = `
    SELECT c.id, c.name, c.type, c.default_pocket_id, p.name AS default_pocket_name,
           c.is_active, c.created_at
    FROM categories c
    LEFT JOIN pockets p ON p.id = c.default_pocket_id
    ${whereClause}
    ORDER BY c.id ASC
  `;

  const res = await pool.query(query, params);
  return res.rows;
}

/**
 * Mengambil kategori berdasarkan nama (case-insensitive).
 * @param {string} name
 * @returns {Promise<object|null>}
 */
export async function getCategoryByName(name) {
  if (!name) return null;
  const res = await pool.query(
    `SELECT c.id, c.name, c.type, c.default_pocket_id, p.name AS default_pocket_name, c.is_active
     FROM categories c
     LEFT JOIN pockets p ON p.id = c.default_pocket_id
     WHERE LOWER(c.name) = LOWER($1) AND c.is_active = TRUE
     LIMIT 1`,
    [name.trim()]
  );
  return res.rows[0] || null;
}

/**
 * Mengambil kategori berdasarkan ID.
 * @param {number} id
 * @returns {Promise<object|null>}
 */
export async function getCategoryById(id) {
  const res = await pool.query(
    `SELECT c.id, c.name, c.type, c.default_pocket_id, p.name AS default_pocket_name, c.is_active
     FROM categories c
     LEFT JOIN pockets p ON p.id = c.default_pocket_id
     WHERE c.id = $1
     LIMIT 1`,
    [id]
  );
  return res.rows[0] || null;
}

/**
 * Membuat kategori baru (hanya atas perintah pengguna).
 * @param {{ name: string, type?: string, defaultPocketId?: number|null }} param0
 * @returns {Promise<object>}
 */
export async function createCategory({ name, type = 'keluar', defaultPocketId = null }) {
  const trimmed = name.trim();
  const res = await pool.query(
    `INSERT INTO categories (name, type, default_pocket_id)
     VALUES ($1, $2, $3)
     RETURNING id, name, type, default_pocket_id, is_active, created_at`,
    [trimmed, type, defaultPocketId]
  );
  logger.info({ categoryId: res.rows[0].id, name: trimmed }, 'Kategori baru berhasil dibuat');
  return res.rows[0];
}

/**
 * Mengubah kategori yang sudah ada.
 * @param {number} id
 * @param {{ name?: string, type?: string, defaultPocketId?: number|null, isActive?: boolean }} updates
 * @returns {Promise<object>}
 */
export async function updateCategory(id, updates = {}) {
  const fields = [];
  const params = [id];

  if (updates.name !== undefined) {
    params.push(updates.name.trim());
    fields.push(`name = $${params.length}`);
  }
  if (updates.type !== undefined) {
    params.push(updates.type);
    fields.push(`type = $${params.length}`);
  }
  if (updates.defaultPocketId !== undefined) {
    params.push(updates.defaultPocketId);
    fields.push(`default_pocket_id = $${params.length}`);
  }
  if (updates.isActive !== undefined) {
    params.push(updates.isActive);
    fields.push(`is_active = $${params.length}`);
  }

  if (fields.length === 0) {
    return getCategoryById(id);
  }

  const query = `
    UPDATE categories
    SET ${fields.join(', ')}
    WHERE id = $1
    RETURNING id, name, type, default_pocket_id, is_active, created_at
  `;
  const res = await pool.query(query, params);
  return res.rows[0];
}

/**
 * Nonaktifkan kategori (soft-delete).
 * @param {number} id
 * @returns {Promise<object>}
 */
export async function deleteCategory(id) {
  const res = await pool.query(
    `UPDATE categories SET is_active = FALSE WHERE id = $1 RETURNING *`,
    [id]
  );
  return res.rows[0];
}

/**
 * Mencari kategori berdasarkan kata kunci di category_rules (Lapis 1 - Instan & Gratis).
 * @param {string} text
 * @returns {Promise<{ ruleId: number, keyword: string, hits: number, source: string, categoryId: number, categoryName: string, categoryType: string, defaultPocketId: number|null, pocketName: string|null }|null>}
 */
export async function findCategoryByRule(text) {
  if (!text) return null;
  const words = text.toLowerCase().match(/[a-z0-9]+/g) || [];
  if (words.length === 0) return null;

  try {
    const res = await pool.query(
      `SELECT cr.id AS rule_id, cr.keyword, cr.hits, cr.source,
              c.id AS category_id, c.name AS category_name, c.type AS category_type,
              p.id AS default_pocket_id, p.name AS default_pocket_name
       FROM category_rules cr
       JOIN categories c ON c.id = cr.category_id AND c.is_active = TRUE
       LEFT JOIN pockets p ON p.id = c.default_pocket_id
       WHERE cr.keyword = ANY($1)
       ORDER BY cr.hits DESC, cr.id ASC
       LIMIT 1`,
      [words]
    );

    if (res.rows.length > 0) {
      const row = res.rows[0];
      return {
        ruleId: row.rule_id,
        keyword: row.keyword,
        hits: row.hits,
        source: row.source,
        categoryId: row.category_id,
        categoryName: row.category_name,
        categoryType: row.category_type,
        defaultPocketId: row.default_pocket_id,
        pocketName: row.default_pocket_name,
      };
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Gagal memeriksa category_rules');
  }
  return null;
}

/**
 * Menambahkan atau memperbarui aturan kata kunci kategori (upsert).
 * @param {{ keyword: string, categoryId: number, source?: 'seed'|'koreksi'|'ai' }} param0
 * @returns {Promise<object>}
 */
export async function upsertCategoryRule({ keyword, categoryId, source = 'koreksi' }) {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) {
    throw new Error('Keyword tidak boleh kosong.');
  }

  const res = await pool.query(
    `INSERT INTO category_rules (keyword, category_id, hits, source, created_at, updated_at)
     VALUES ($1, $2, 1, $3, now(), now())
     ON CONFLICT (keyword) DO UPDATE
     SET category_id = EXCLUDED.category_id,
         hits = category_rules.hits + 1,
         source = EXCLUDED.source,
         updated_at = now()
     RETURNING id, keyword, category_id, hits, source, created_at, updated_at`,
    [normalizedKeyword, categoryId, source]
  );

  return res.rows[0];
}

/**
 * Belajar dari koreksi pengguna (prd.md §8.9).
 * Mengekstrak kata-kata signifikan dari catatan/teks transaksi lalu membentuk atau menaikkan aturan category_rules.
 * @param {{ text: string, categoryId: number }} param0
 * @returns {Promise<Array<object>>} Aturan yang terbentuk/diperbarui
 */
export async function learnFromCorrection({ text, categoryId }) {
  if (!text || !categoryId) return [];

  const rawWords = text.toLowerCase().match(/[a-z0-9]+/g) || [];
  const candidateWords = rawWords.filter(
    (w) => w.length >= 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w)
  );

  // Jika semua kata tersaring (misal kata pendek atau angka), coba ambil kata dengan panjang >= 2
  const wordsToLearn = candidateWords.length > 0
    ? candidateWords
    : rawWords.filter((w) => w.length >= 2 && !/^\d+$/.test(w));

  const results = [];
  for (const word of wordsToLearn) {
    try {
      const rule = await upsertCategoryRule({
        keyword: word,
        categoryId,
        source: 'koreksi',
      });
      results.push(rule);
      logger.info(
        { keyword: word, categoryId, hits: rule.hits },
        'Aturan kategori berhasil dipelajari dari koreksi'
      );
    } catch (err) {
      logger.warn({ err: err.message, keyword: word }, 'Gagal menyimpan aturan kategori');
    }
  }

  return results;
}

/**
 * Mengambil daftar aturan kategori.
 * @param {{ categoryId?: number|null, limit?: number }} [options]
 * @returns {Promise<Array<object>>}
 */
export async function getCategoryRules({ categoryId = null, limit = 100 } = {}) {
  const conditions = [];
  const params = [];

  if (categoryId) {
    params.push(categoryId);
    conditions.push(`cr.category_id = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);

  const query = `
    SELECT cr.id, cr.keyword, cr.category_id, c.name AS category_name,
           cr.hits, cr.source, cr.created_at, cr.updated_at
    FROM category_rules cr
    JOIN categories c ON c.id = cr.category_id
    ${whereClause}
    ORDER BY cr.hits DESC, cr.updated_at DESC
    LIMIT $${params.length}
  `;

  const res = await pool.query(query, params);
  return res.rows;
}

/**
 * Menghapus aturan kategori berdasarkan ID.
 * @param {number} id
 * @returns {Promise<object>}
 */
export async function deleteCategoryRule(id) {
  const res = await pool.query('DELETE FROM category_rules WHERE id = $1 RETURNING *', [id]);
  if (res.rowCount === 0) {
    throw new Error(`Aturan kategori #${id} tidak ditemukan.`);
  }
  return res.rows[0];
}

/**
 * Memperbarui aturan kategori (keyword atau category_id).
 * @param {number} id
 * @param {{ keyword?: string, categoryId?: number }} updates
 * @returns {Promise<object>}
 */
export async function updateCategoryRule(id, updates = {}) {
  const sets = [];
  const values = [];

  if (updates.keyword !== undefined) {
    const kw = updates.keyword.trim().toLowerCase();
    if (!kw) throw new Error('Keyword tidak boleh kosong.');
    values.push(kw);
    sets.push(`keyword = $${values.length}`);
  }
  if (updates.categoryId !== undefined) {
    values.push(updates.categoryId);
    sets.push(`category_id = $${values.length}`);
  }

  if (sets.length === 0) {
    const check = await pool.query('SELECT * FROM category_rules WHERE id = $1', [id]);
    if (check.rowCount === 0) throw new Error(`Aturan kategori #${id} tidak ditemukan.`);
    return check.rows[0];
  }

  sets.push('updated_at = now()');
  values.push(id);
  const sql = `UPDATE category_rules SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`;
  const res = await pool.query(sql, values);
  if (res.rowCount === 0) {
    throw new Error(`Aturan kategori #${id} tidak ditemukan.`);
  }
  return res.rows[0];
}
