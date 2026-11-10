-- 0001_fondasi.sql : tabel dasar Fase 1
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE processed_messages (
  message_id   TEXT PRIMARY KEY,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chat_history (
  id          BIGSERIAL PRIMARY KEY,
  role        TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ai_usage_log (
  id          BIGSERIAL PRIMARY KEY,
  model       TEXT NOT NULL,
  purpose     TEXT NOT NULL,
  tokens_in   INT,
  tokens_out  INT,
  latency_ms  INT,
  ok          BOOLEAN NOT NULL,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bot_events (
  id          BIGSERIAL PRIMARY KEY,
  type        TEXT NOT NULL,
  detail      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO settings (key, value) VALUES
  ('timezone', '"Asia/Jakarta"'),
  ('groq_rpm_limit', '20');
