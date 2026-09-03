-- =============================================================
--  Migration 005 - Tutor referrals (lecturer nominate, admin approve)
--
--  Lecturers refer tutor candidates for their own modules.
--  Admins countersign with a responsibility level.
--
--  Run once:
--  psql -U postgres -d veriflow -f migrations/005_referrals.sql
-- =============================================================

BEGIN;

CREATE TYPE referral_status AS ENUM (
  'pending',
  'approved',
  'rejected'
);

CREATE TABLE referrals (
  id                    SERIAL PRIMARY KEY,
  lecturer_id           INT          NOT NULL REFERENCES users (id),
  first_names           VARCHAR(100) NOT NULL,
  surname               VARCHAR(100) NOT NULL,
  email                 VARCHAR(150) NOT NULL,
  course                VARCHAR(50)  NOT NULL,
  module_code           VARCHAR(20)  NOT NULL,
  module_name           VARCHAR(150) NOT NULL,
  qualification_level   qualification_level NOT NULL,
  status                referral_status NOT NULL DEFAULT 'pending',
  responsibility_level  responsibility_level,
  rejection_reason      TEXT,
  reviewed_by           INT          REFERENCES users (id),
  reviewed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_referrals_lecturer ON referrals (lecturer_id);
CREATE INDEX idx_referrals_status   ON referrals (status);
CREATE INDEX idx_referrals_email    ON referrals (LOWER(email));

-- One pending referral per email + module at a time
CREATE UNIQUE INDEX idx_referrals_pending_email_module
  ON referrals (LOWER(email), module_code)
  WHERE status = 'pending';

CREATE TRIGGER trg_referrals_updated_at
  BEFORE UPDATE ON referrals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
