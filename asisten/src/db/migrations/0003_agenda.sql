-- 0003_agenda.sql : Agenda, Pengingat, Catatan (Fase 4)
-- Sesuai prd.md §8.11, §9.3 dan 04-fase4-agenda.md

-- ---------- Agenda (Events & Tasks) ----------
CREATE TABLE IF NOT EXISTS events (
  id               BIGSERIAL PRIMARY KEY,
  kind             TEXT NOT NULL CHECK (kind IN ('event','task')),
  title            TEXT NOT NULL,
  description      TEXT,
  starts_at        TIMESTAMPTZ NOT NULL,             -- waktu event / deadline task
  ends_at          TIMESTAMPTZ,
  all_day          BOOLEAN NOT NULL DEFAULT FALSE,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  recurrence       TEXT,                             -- 'daily' | 'weekly:MON' | 'monthly:15'
  remind_offsets   INT[] NOT NULL DEFAULT '{1440,60}', -- menit sebelum starts_at
  bot_reply_id     TEXT,
  deleted_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_start ON events (starts_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_events_status ON events (status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_events_kind ON events (kind) WHERE deleted_at IS NULL;

-- ---------- Pengingat (Materialisasi dari Events) ----------
CREATE TABLE IF NOT EXISTS reminders (
  id              BIGSERIAL PRIMARY KEY,
  event_id        BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  remind_at       TIMESTAMPTZ NOT NULL,
  offset_minutes  INTEGER NOT NULL DEFAULT 0,
  sent_at         TIMESTAMPTZ
);

-- Drop unique lama jika ada dan tambahkan yang baru berdasarkan (event_id, offset_minutes)
ALTER TABLE reminders DROP CONSTRAINT IF EXISTS reminders_event_id_remind_at_key;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS offset_minutes INTEGER NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reminders_event_id_offset_key'
  ) THEN
    ALTER TABLE reminders ADD CONSTRAINT reminders_event_id_offset_key UNIQUE (event_id, offset_minutes);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders (remind_at) WHERE sent_at IS NULL;

-- ---------- Catatan (Notes) ----------
CREATE TABLE IF NOT EXISTS notes (
  id            BIGSERIAL PRIMARY KEY,
  content       TEXT NOT NULL,
  note_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  tags          TEXT[] NOT NULL DEFAULT '{}',
  bot_reply_id  TEXT,
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notes_fts ON notes USING GIN (to_tsvector('simple', content)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notes_date ON notes (note_date) WHERE deleted_at IS NULL;

