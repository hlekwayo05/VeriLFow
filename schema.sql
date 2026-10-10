-- VeriFlow - supplemental schema for Supabase SQL editor
-- Run this after your base schema is in place.
-- Migrations 007 and 008 in backend/migrations/ apply the same changes locally.

-- =============================================================
--  ENUMS
-- =============================================================

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

-- Job postings were removed (see backend/migrations/030_drop_job_postings.sql).

-- =============================================================
--  FEATURE 2 - GLOBAL APPLICATION WINDOW + SETTINGS
-- =============================================================

CREATE TABLE IF NOT EXISTS settings (
  id                    INTEGER PRIMARY KEY DEFAULT 1,
  min_average           NUMERIC(5,2) DEFAULT 75,
  module_pass_mark      NUMERIC(5,2) DEFAULT 70,
  cv_keywords           TEXT DEFAULT 'database, SQL, networking, programming, data structures, algorithms, systems analysis',
  min_cv_keywords       INTEGER DEFAULT 0,
  applications_open     BOOLEAN DEFAULT false,
  closing_date          DATE,
  announcement_subject  TEXT DEFAULT 'Tutor Applications Now Open - 2026',
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

-- =============================================================
--  FEATURE 3 - STUDENT LIST
-- =============================================================

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

-- =============================================================
--  CURRICULUM MODULES (reference table)
-- =============================================================

CREATE TABLE IF NOT EXISTS modules (
  code           VARCHAR(20) PRIMARY KEY,
  name           TEXT NOT NULL,
  course         programme_type NOT NULL,
  year_semester  VARCHAR(50) NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS module_code VARCHAR(20);
