-- =============================================================
--  Migration 008 — Application settings row + students list
--
--  Run once:
--  psql -U postgres -d veriflow -f migrations/008_settings_students.sql
-- =============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS settings (
  id                    INTEGER PRIMARY KEY DEFAULT 1,
  min_average           NUMERIC(5,2) DEFAULT 75,
  module_pass_mark      NUMERIC(5,2) DEFAULT 70,
  cv_keywords           TEXT DEFAULT 'database, SQL, networking, programming, data structures, algorithms, systems analysis',
  min_cv_keywords       INTEGER DEFAULT 0,
  applications_open     BOOLEAN DEFAULT FALSE,
  closing_date          DATE,
  announcement_subject  TEXT DEFAULT 'Tutor Applications Now Open — 2026',
  announcement_body     TEXT DEFAULT
    'Dear Students,

Applications are now open for tutor positions for the 2026 academic year. To apply click the link below.

Closing date: {closing_date}

Kind regards,
Student Employment Office
University of Mpumalanga',
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT settings_singleton CHECK (id = 1)
);

INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Pull screening values from legacy key-value store when available
UPDATE settings s SET
  cv_keywords      = COALESCE(ss_cv.value, s.cv_keywords),
  min_average      = COALESCE(ss_avg.value::NUMERIC, s.min_average),
  module_pass_mark = COALESCE(ss_mod.value::NUMERIC, s.module_pass_mark),
  min_cv_keywords  = COALESCE(ss_kw.value::INTEGER, s.min_cv_keywords)
FROM (SELECT 1) AS dummy
LEFT JOIN system_settings ss_cv  ON ss_cv.key  = 'cv_keywords'
LEFT JOIN system_settings ss_avg ON ss_avg.key = 'min_average'
LEFT JOIN system_settings ss_mod ON ss_mod.key = 'module_pass_mark'
LEFT JOIN system_settings ss_kw  ON ss_kw.key  = 'min_cv_keywords'
WHERE s.id = 1;

DROP TRIGGER IF EXISTS trg_settings_updated_at ON settings;
CREATE TRIGGER trg_settings_updated_at
  BEFORE UPDATE ON settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS students (
  id              SERIAL PRIMARY KEY,
  first_names     TEXT NOT NULL,
  surname         TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,
  student_number  VARCHAR(20) UNIQUE,
  programme       programme_type,
  year_level      VARCHAR(20),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_students_surname ON students (surname);
CREATE INDEX IF NOT EXISTS idx_students_email   ON students (email);

COMMIT;
