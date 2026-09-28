-- =============================================================
--  Migration 029 — Attendance pass one-time use
-- =============================================================

BEGIN;

ALTER TABLE attendance_passes
  ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;

ALTER TABLE attendance_passes
  ADD COLUMN IF NOT EXISTS used_by_student VARCHAR(32);

COMMIT;
