-- =============================================================
--  Migration 006 - Job postings (open tutor positions)
--
--  Admin creates postings per course + module. Applications are
--  validated against an open posting on submit (qualification,
--  declared average, and document screening).
--
--  Run once:
--  psql -U postgres -d veriflow -f migrations/006_job_postings.sql
-- =============================================================

BEGIN;

CREATE TYPE posting_status AS ENUM (
  'open',
  'closed'
);

CREATE TABLE job_postings (
  id                      SERIAL PRIMARY KEY,
  course                  VARCHAR(50)  NOT NULL,
  module_code             VARCHAR(20)  NOT NULL,
  module_name             VARCHAR(150) NOT NULL,
  position_type           VARCHAR(50)  NOT NULL DEFAULT 'Tutor',
  min_qualification_level qualification_level NOT NULL DEFAULT '3rd_year',
  min_average             NUMERIC(5,2) NOT NULL DEFAULT 65 CHECK (min_average >= 0 AND min_average <= 100),
  apps_needed             SMALLINT     NOT NULL DEFAULT 1 CHECK (apps_needed >= 1),
  module_pass_required    BOOLEAN      NOT NULL DEFAULT TRUE,
  notes                   TEXT,
  status                  posting_status NOT NULL DEFAULT 'open',
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  UNIQUE (course, module_name, status)
);

CREATE INDEX idx_job_postings_course_module ON job_postings (course, module_name);
CREATE INDEX idx_job_postings_status       ON job_postings (status);

CREATE TRIGGER trg_job_postings_updated_at
  BEFORE UPDATE ON job_postings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed open postings aligned with curriculum module names (not display codes).
INSERT INTO job_postings
  (course, module_code, module_name, min_qualification_level, min_average, apps_needed, status)
VALUES
  ('DICT - Diploma in ICT',     'IS211',  'Information Systems',     '3rd_year', 65, 5, 'open'),
  ('DICT - Diploma in ICT',     'APD301', 'Application Development', '3rd_year', 65, 4, 'open'),
  ('BICT - Bachelor of ICT',    'CN202',  'Communication Networks',  '4th_year_honours', 60, 3, 'open'),
  ('BICT - Bachelor of ICT',    'IS310',  'Cybersecurity',           '3rd_year', 65, 2, 'closed')
ON CONFLICT (course, module_name, status) DO NOTHING;

COMMIT;
