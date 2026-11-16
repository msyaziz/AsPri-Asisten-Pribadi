import readline from 'readline';
import bcrypt from 'bcryptjs';
import { pool } from '../src/db/pool.js';
import { env } from '../src/config/env.js';

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

export async function createAdmin(emailInput, passwordInput) {
  let email = emailInput;
  let password = passwordInput;

  if (!email) {
    email = await askQuestion(`Masukkan email admin [${env.ADMIN_EMAIL || 'admin@example.com'}]: `);
    if (!email) email = env.ADMIN_EMAIL || 'admin@example.com';
  }

  if (!password) {
    password = await askQuestion('Masukkan password admin (min 6 karakter): ');
  }

  if (!email || !email.includes('@')) {
    throw new Error('Format email tidak valid.');
  }

  if (!password || password.length < 6) {
    throw new Error('Password minimal 6 karakter.');
  }

  const saltRounds = 10;
  const hash = await bcrypt.hash(password, saltRounds);

  const res = await pool.query(
    `INSERT INTO admin_users (email, password_hash)
     VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE
     SET password_hash = EXCLUDED.password_hash
     RETURNING id, email, created_at`,
    [email.toLowerCase().trim(), hash]
  );

  return res.rows[0];
}

// Jika dijalankan langsung dari CLI
if (process.argv[1] && process.argv[1].endsWith('create-admin.js')) {
  const args = process.argv.slice(2);
  let cliEmail = null;
  let cliPass = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--email' && args[i + 1]) cliEmail = args[++i];
    if (args[i] === '--password' && args[i + 1]) cliPass = args[++i];
  }

  createAdmin(cliEmail, cliPass)
    .then((user) => {
      console.log(`✅ Admin user berhasil disimpan: id=${user.id}, email=${user.email}`);
      return pool.end();
    })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Gagal membuat admin:', err.message);
      pool.end().finally(() => process.exit(1));
    });
}

