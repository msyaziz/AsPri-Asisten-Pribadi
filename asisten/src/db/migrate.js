process.env.MIGRATION_MODE = '1';

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './pool.js';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations');

/**
 * Menjalankan migrasi SQL yang belum pernah dieksekusi.
 * @returns {Promise<string[]>} Daftar file migrasi yang baru dijalankan.
 */
export async function runMigrations() {
  const client = await pool.connect();
  const executedFiles = [];

  try {
    // 1. Pastikan tabel schema_migrations tersedia
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // 2. Ambil daftar migrasi yang sudah tercatat
    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const executedSet = new Set(rows.map((r) => r.name));

    // 3. Baca semua file migrasi .sql dan urutkan secara alfabet
    const entries = await fs.readdir(MIGRATIONS_DIR);
    const sqlFiles = entries.filter((file) => file.endsWith('.sql')).sort();

    // 4. Jalankan setiap migrasi baru dalam satu transaksi
    for (const file of sqlFiles) {
      if (executedSet.has(file)) {
        continue;
      }

      logger.info({ migration: file }, 'Menjalankan file migrasi...');
      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = await fs.readFile(filePath, 'utf-8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        executedFiles.push(file);
        logger.info({ migration: file }, 'Migrasi berhasil dieksekusi.');
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error({ migration: file, err: err.message }, 'Gagal mengeksekusi migrasi, rollback.');
        throw err;
      }
    }

    return executedFiles;
  } finally {
    client.release();
  }
}

// Jalankan langsung jika dipanggil via CLI (npm run migrate)
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  runMigrations()
    .then((files) => {
      if (files.length === 0) {
        console.log('Semua migrasi sudah up to date. Tidak ada migrasi baru.');
      } else {
        console.log(`Berhasil mengeksekusi ${files.length} migrasi: ${files.join(', ')}`);
      }
      return pool.end();
    })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migrasi database gagal:', err.message);
      pool.end().finally(() => process.exit(1));
    });
}
