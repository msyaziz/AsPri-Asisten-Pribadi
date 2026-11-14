-- 0002_keuangan.sql : Keuangan Inti (Fase 2)
-- Sesuai prd.md §9.3 sampai §9.5 dan 02-fase2-keuangan-inti.md

-- ---------- Keuangan: periode & kantong ----------
CREATE TABLE IF NOT EXISTS periods (
  id            SERIAL PRIMARY KEY,
  year          SMALLINT NOT NULL,
  month         SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  main_opening  BIGINT NOT NULL DEFAULT 0,   -- sisa utama + dana 'return' + defisit (negatif) dari bulan lalu
  closed_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (year, month)
);

CREATE TABLE IF NOT EXISTS pockets (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order     INT NOT NULL DEFAULT 0,
  rollover_mode  TEXT NOT NULL DEFAULT 'carry' CHECK (rollover_mode IN ('carry','return')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS period_pockets (
  period_id        INT NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
  pocket_id        INT NOT NULL REFERENCES pockets(id),
  alloc_percent    NUMERIC(5,2) CHECK (alloc_percent BETWEEN 0 AND 100),  -- NULL jika pakai nominal tetap
  alloc_amount     BIGINT NOT NULL DEFAULT 0 CHECK (alloc_amount >= 0),
  rollover_in      BIGINT NOT NULL DEFAULT 0 CHECK (rollover_in >= 0),
  closing_balance  BIGINT,                                                -- snapshot saat periode ditutup
  low_alert_sent   BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (period_id, pocket_id)
);

-- ---------- Kategori ----------
CREATE TABLE IF NOT EXISTS categories (
  id                 SERIAL PRIMARY KEY,
  name               TEXT NOT NULL UNIQUE,
  type               TEXT NOT NULL DEFAULT 'keluar' CHECK (type IN ('keluar','masuk','both')),
  default_pocket_id  INT REFERENCES pockets(id) ON DELETE SET NULL,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS category_rules (
  id          SERIAL PRIMARY KEY,
  keyword     TEXT NOT NULL UNIQUE,          -- huruf kecil, kata utuh
  category_id INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  hits        INT NOT NULL DEFAULT 1,
  source      TEXT NOT NULL CHECK (source IN ('seed','koreksi','ai')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Struk (diperlukan untuk relasi foreign key) ----------
CREATE TABLE IF NOT EXISTS receipts (
  id            SERIAL PRIMARY KEY,
  file_path     TEXT NOT NULL,
  merchant      TEXT,
  total         BIGINT,
  receipt_date  DATE,
  items         JSONB,                       -- rincian item (v1 hanya disimpan)
  raw_json      JSONB,                       -- keluaran mentah model vision
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','confirmed','rejected','failed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Target tabungan (diperlukan untuk relasi foreign key) ----------
CREATE TABLE IF NOT EXISTS savings_goals (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  target_amount  BIGINT NOT NULL CHECK (target_amount > 0),
  deadline       DATE,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','cancelled')),
  deleted_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Transaksi ----------
CREATE TABLE IF NOT EXISTS transactions (
  id                 BIGSERIAL PRIMARY KEY,
  period_id          INT NOT NULL REFERENCES periods(id),
  type               TEXT NOT NULL CHECK (type IN ('masuk','keluar')),
  amount             BIGINT NOT NULL CHECK (amount > 0),
  category_id        INT REFERENCES categories(id),
  pocket_id          INT REFERENCES pockets(id),     -- NULL = saldo utama
  note               TEXT,
  tx_date            DATE NOT NULL,
  occurred_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  source             TEXT NOT NULL CHECK (source IN ('teks','struk','dashboard','recurring')),
  is_monthly_income  BOOLEAN NOT NULL DEFAULT FALSE,
  ai_confidence      NUMERIC(3,2),
  wa_message_id      TEXT,                           -- pesan pengguna
  bot_reply_id       TEXT,                           -- balasan konfirmasi bot (untuk undo via reply)
  receipt_id         INT REFERENCES receipts(id),
  goal_id            INT REFERENCES savings_goals(id),
  deleted_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tx_period_pocket ON transactions (period_id, pocket_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tx_date          ON transactions (tx_date)              WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tx_category      ON transactions (category_id)          WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tx_bot_reply     ON transactions (bot_reply_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tx_wa_msg  ON transactions (wa_message_id, amount, COALESCE(note,'')) WHERE wa_message_id IS NOT NULL;

-- ---------- Transfer Antar Kantong ----------
CREATE TABLE IF NOT EXISTS pocket_transfers (
  id              BIGSERIAL PRIMARY KEY,
  period_id       INT NOT NULL REFERENCES periods(id),
  from_pocket_id  INT REFERENCES pockets(id),        -- NULL = saldo utama
  to_pocket_id    INT REFERENCES pockets(id),        -- NULL = saldo utama
  amount          BIGINT NOT NULL CHECK (amount > 0),
  note            TEXT,
  bot_reply_id    TEXT,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_pocket_id IS DISTINCT FROM to_pocket_id)
);

CREATE INDEX IF NOT EXISTS idx_tr_period ON pocket_transfers (period_id) WHERE deleted_at IS NULL;

-- ---------- Pending Actions ----------
CREATE TABLE IF NOT EXISTS pending_actions (
  id             BIGSERIAL PRIMARY KEY,
  type           TEXT NOT NULL,                      -- 'struk' | 'transaksi_besar' | 'uang_bulanan' | 'hapus_kantong' | 'pilih_kategori' | ...
  payload        JSONB NOT NULL,
  wa_message_id  TEXT,
  bot_reply_id   TEXT,
  status         TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','confirmed','rejected','expired')),
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pending_waiting ON pending_actions (expires_at) WHERE status = 'waiting';

-- ---------- Action Log (Undo / Audit) ----------
CREATE TABLE IF NOT EXISTS action_log (
  id            BIGSERIAL PRIMARY KEY,
  entity        TEXT NOT NULL,                       -- 'transaction' | 'transfer' | 'event' | 'note' | 'debt' | 'pocket' | ...
  entity_id     BIGINT NOT NULL,
  action        TEXT NOT NULL CHECK (action IN ('create','update','delete','restore')),
  before_data   JSONB,
  after_data    JSONB,
  bot_reply_id  TEXT,
  undone        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_actionlog_recent ON action_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_actionlog_reply  ON action_log (bot_reply_id);

-- ---------- Seed Awal ----------
INSERT INTO pockets (name, sort_order, rollover_mode) VALUES
  ('Kebutuhan', 1, 'carry'),
  ('Tabungan',  2, 'carry'),
  ('Hiburan',   3, 'return'),
  ('Darurat',   4, 'carry')
ON CONFLICT (name) DO NOTHING;

INSERT INTO categories (name, type, default_pocket_id) VALUES
  ('Makanan',   'keluar', (SELECT id FROM pockets WHERE name='Kebutuhan')),
  ('Transport', 'keluar', (SELECT id FROM pockets WHERE name='Kebutuhan')),
  ('Tagihan',   'keluar', (SELECT id FROM pockets WHERE name='Kebutuhan')),
  ('Belanja',   'keluar', (SELECT id FROM pockets WHERE name='Kebutuhan')),
  ('Hiburan',   'keluar', (SELECT id FROM pockets WHERE name='Hiburan')),
  ('Kesehatan', 'keluar', (SELECT id FROM pockets WHERE name='Darurat')),
  ('Tabungan',  'keluar', (SELECT id FROM pockets WHERE name='Tabungan')),
  ('Lainnya',   'keluar', NULL),
  ('Gaji',      'masuk',  NULL),
  ('Lain-lain', 'masuk',  NULL)
ON CONFLICT (name) DO NOTHING;

INSERT INTO category_rules (keyword, category_id, source) VALUES
  ('makan',   (SELECT id FROM categories WHERE name='Makanan'), 'seed'),
  ('bensin',  (SELECT id FROM categories WHERE name='Transport'), 'seed'),
  ('ojek',    (SELECT id FROM categories WHERE name='Transport'), 'seed'),
  ('listrik', (SELECT id FROM categories WHERE name='Tagihan'), 'seed'),
  ('wifi',    (SELECT id FROM categories WHERE name='Tagihan'), 'seed'),
  ('kopi',    (SELECT id FROM categories WHERE name='Hiburan'), 'seed'),
  ('nonton',  (SELECT id FROM categories WHERE name='Hiburan'), 'seed'),
  ('obat',    (SELECT id FROM categories WHERE name='Kesehatan'), 'seed')
ON CONFLICT (keyword) DO NOTHING;

INSERT INTO settings (key, value) VALUES
  ('default_rollover_mode', '"carry"'),
  ('low_pocket_threshold', '0.20'),
  ('big_tx_threshold', '1000000'),
  ('briefing_time', '"07:00"'),
  ('weekly_report_day_time', '{"day":"SUN","time":"20:00"}'),
  ('undo_window_hours', '24')
ON CONFLICT (key) DO NOTHING;

-- ---------- Views Saldo (Sumber Kebenaran Angka) ----------
CREATE OR REPLACE VIEW v_pocket_balance AS
SELECT
  pp.period_id,
  pp.pocket_id,
  p.name AS pocket_name,
  pp.rollover_in,
  pp.alloc_amount,
  COALESCE(inc.s, 0)  AS income_direct,
  COALESCE(tin.s, 0)  AS transfer_in,
  COALESCE(tout.s, 0) AS transfer_out,
  COALESCE(exp.s, 0)  AS spent,
  pp.rollover_in + pp.alloc_amount + COALESCE(inc.s,0) + COALESCE(tin.s,0)
    - COALESCE(tout.s,0) - COALESCE(exp.s,0) AS balance
FROM period_pockets pp
JOIN pockets p ON p.id = pp.pocket_id
LEFT JOIN LATERAL (
  SELECT SUM(amount) s FROM transactions t
  WHERE t.period_id = pp.period_id AND t.pocket_id = pp.pocket_id
    AND t.type = 'masuk' AND t.deleted_at IS NULL) inc ON TRUE
LEFT JOIN LATERAL (
  SELECT SUM(amount) s FROM transactions t
  WHERE t.period_id = pp.period_id AND t.pocket_id = pp.pocket_id
    AND t.type = 'keluar' AND t.deleted_at IS NULL) exp ON TRUE
LEFT JOIN LATERAL (
  SELECT SUM(amount) s FROM pocket_transfers x
  WHERE x.period_id = pp.period_id AND x.to_pocket_id = pp.pocket_id
    AND x.deleted_at IS NULL) tin ON TRUE
LEFT JOIN LATERAL (
  SELECT SUM(amount) s FROM pocket_transfers x
  WHERE x.period_id = pp.period_id AND x.from_pocket_id = pp.pocket_id
    AND x.deleted_at IS NULL) tout ON TRUE;

CREATE OR REPLACE VIEW v_main_balance AS
SELECT
  pr.id AS period_id,
  pr.main_opening
  + COALESCE((SELECT SUM(amount) FROM transactions t
              WHERE t.period_id = pr.id AND t.pocket_id IS NULL
                AND t.type = 'masuk' AND t.deleted_at IS NULL), 0)
  - COALESCE((SELECT SUM(alloc_amount) FROM period_pockets pp WHERE pp.period_id = pr.id), 0)
  - COALESCE((SELECT SUM(amount) FROM transactions t
              WHERE t.period_id = pr.id AND t.pocket_id IS NULL
                AND t.type = 'keluar' AND t.deleted_at IS NULL), 0)
  - COALESCE((SELECT SUM(amount) FROM pocket_transfers x
              WHERE x.period_id = pr.id AND x.from_pocket_id IS NULL AND x.deleted_at IS NULL), 0)
  + COALESCE((SELECT SUM(amount) FROM pocket_transfers x
              WHERE x.period_id = pr.id AND x.to_pocket_id IS NULL AND x.deleted_at IS NULL), 0)
  AS main_balance
FROM periods pr;

