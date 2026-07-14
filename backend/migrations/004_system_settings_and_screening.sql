-- =============================================================
--  Migration 004 — System settings + application screening
--
--  Adds admin-configurable CV keywords and eligibility thresholds,
--  plus columns to store automated document scan results.
--
--  Run once:
--  psql -U postgres -d veriflow -f migrations/004_system_settings_and_screening.sql
-- =============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS system_settings (
  key         VARCHAR(100) PRIMARY KEY,
  value       TEXT         NOT NULL,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO system_settings (key, value) VALUES
  ('cv_keywords',      'database, SQL, networking, programming, data structures, algorithms, systems analysis'),
  ('min_average',      '75'),
  ('module_pass_mark', '70'),
  ('min_cv_keywords',  '0')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS cv_keyword_score  INT,
  ADD COLUMN IF NOT EXISTS screening_result  JSONB;

COMMIT;
