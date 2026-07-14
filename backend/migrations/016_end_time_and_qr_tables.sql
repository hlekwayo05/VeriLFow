-- Migration 016: sessions.end_time + consolidated QR/class-list tables

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS end_time TIME;

CREATE TABLE IF NOT EXISTS class_list_entries (
  id              SERIAL PRIMARY KEY,
  module_code     VARCHAR(20)  NOT NULL,
  student_number  VARCHAR(20)  NOT NULL,
  full_name       TEXT         NOT NULL,
  email           VARCHAR(255),
  year_level      VARCHAR(20),
  status          VARCHAR(20)  NOT NULL DEFAULT 'Active',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (module_code, student_number)
);

CREATE INDEX IF NOT EXISTS idx_class_list_module ON class_list_entries (module_code);
CREATE INDEX IF NOT EXISTS idx_class_list_email ON class_list_entries (email);

CREATE TABLE IF NOT EXISTS session_qr_tokens (
  id          SERIAL PRIMARY KEY,
  session_id  INT          NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  token       VARCHAR(64)  NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ  NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_qr_tokens_session ON session_qr_tokens (session_id);
CREATE INDEX IF NOT EXISTS idx_session_qr_tokens_expires ON session_qr_tokens (expires_at);

CREATE TABLE IF NOT EXISTS attendance_passes (
  token       VARCHAR(64)  NOT NULL PRIMARY KEY,
  session_id  INT          NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ  NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attendance_passes_session ON attendance_passes (session_id);
