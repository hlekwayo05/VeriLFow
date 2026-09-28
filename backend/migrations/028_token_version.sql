-- =============================================================
--  Migration 028 — JWT token_version for session revocation
-- =============================================================

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

COMMIT;
