-- =============================================================
--  Migration 007 — Postings table (replaces job_postings)
--
--  Run once:
--  psql -U postgres -d veriflow -f migrations/007_postings_table.sql
-- =============================================================

BEGIN;

DO $$ BEGIN
  CREATE TYPE position_type AS ENUM ('tutor', 'demonstrator');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE programme_type AS ENUM ('DICT', 'BICT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS postings (
  id                    SERIAL PRIMARY KEY,
  module_code           VARCHAR(20)   NOT NULL,
  module_name           TEXT          NOT NULL,
  programme             programme_type NOT NULL,
  position_type         position_type NOT NULL DEFAULT 'tutor',
  min_year_level        VARCHAR(20)   NOT NULL,
  min_average           NUMERIC(5,2)  NOT NULL DEFAULT 65
                        CHECK (min_average >= 0 AND min_average <= 100),
  applications_needed   INTEGER       NOT NULL DEFAULT 1
                        CHECK (applications_needed >= 1),
  module_pass_required  BOOLEAN       NOT NULL DEFAULT TRUE,
  notes                 TEXT,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  UNIQUE (programme, module_name)
);

CREATE INDEX IF NOT EXISTS idx_postings_programme_module ON postings (programme, module_name);
CREATE INDEX IF NOT EXISTS idx_postings_module_code      ON postings (module_code);

DROP TRIGGER IF EXISTS trg_postings_updated_at ON postings;
CREATE TRIGGER trg_postings_updated_at
  BEFORE UPDATE ON postings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Migrate existing job_postings data when present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'job_postings'
  ) THEN
    INSERT INTO postings (
      module_code,
      module_name,
      programme,
      position_type,
      min_year_level,
      min_average,
      applications_needed,
      module_pass_required,
      notes,
      created_at,
      updated_at
    )
    SELECT
      jp.module_code,
      jp.module_name,
      CASE
        WHEN jp.course ILIKE 'BICT%' THEN 'BICT'::programme_type
        ELSE 'DICT'::programme_type
      END,
      CASE
        WHEN LOWER(jp.position_type) LIKE 'demonstrator%' THEN 'demonstrator'::position_type
        ELSE 'tutor'::position_type
      END,
      CASE jp.min_qualification_level
        WHEN '4th_year_honours' THEN '4th year+'
        WHEN 'masters'           THEN 'Masters+'
        WHEN 'masters_holder'      THEN 'Masters holder+'
        WHEN 'phd'                 THEN 'PhD+'
        ELSE '3rd year+'
      END,
      jp.min_average,
      jp.apps_needed,
      jp.module_pass_required,
      jp.notes,
      jp.created_at,
      jp.updated_at
    FROM job_postings jp
    WHERE jp.status = 'open'
    ON CONFLICT (programme, module_name) DO NOTHING;

    DROP TABLE job_postings CASCADE;
  END IF;
END $$;

DROP TYPE IF EXISTS posting_status;

COMMIT;
