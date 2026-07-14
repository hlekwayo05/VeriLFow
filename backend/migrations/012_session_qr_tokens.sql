-- Migration 012: rotating QR tokens + long-lived attendance passes

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
