/*
 * VERIFLOW DATABASE INIT SEQUENCE
 * ================================
 * For a fresh database (local or Supabase), run:
 *   npm run db:schema
 * (from backend/, with DATABASE_URL set in backend/.env)
 *
 * Or manually:
 *   psql "$DATABASE_URL" -f backend/schema.sql
 *
 * This file creates all tables, enums, indexes, and
 * triggers in the correct order.
 *
 * For existing databases that were built incrementally,
 * also run any pending migrations in backend/migrations/
 * in order.
 */

-- =============================================================
--  VeriFlow — PostgreSQL Schema
-- =============================================================

-- =============================================================
--  ENUMS
--  Declared once here, referenced in table columns below.
-- =============================================================

CREATE TYPE user_role AS ENUM (
  'admin',
  'lecturer',
  'tutor'
);

CREATE TYPE application_status AS ENUM (
  'incomplete',       -- account created at step 1, academic info not yet saved
  'submitted',        -- step 3 complete, eligibility passed
  'under_review',     -- admin has opened the application for review
  'shortlisted',      -- admin has shortlisted this applicant for final decision
  'approved',         -- admin approved + assigned responsibility level
  'rejected'          -- failed eligibility check, or admin rejected
);

CREATE TYPE responsibility_level AS ENUM (
  'standard',
  'senior',
  'lead'
);

CREATE TYPE qualification_level AS ENUM (
  '3rd_year',
  '4th_year_honours',
  'masters',
  'masters_holder',
  'phd'
);

CREATE TYPE session_type AS ENUM (
  'tutorial',   -- 45-min → claims 3 hours
  'practical',  -- 3-hour → claims 5 hours
  'online',     -- treated as tutorial for claims
  'revision',   -- treated as tutorial for claims
  'lecture'     -- treated as tutorial for claims
);

CREATE TYPE session_status AS ENUM (
  'scheduled',
  'active',     -- session code is live
  'completed',
  'flagged',    -- disputed or suspicious
  'cancelled'   -- lecturer cancelled / called off
);

CREATE TYPE claim_status AS ENUM (
  'pending_lecturer',
  'pending_coordinator',
  'approved',
  'returned_by_lecturer',
  'returned_by_coordinator'
);

DO $$ BEGIN
  CREATE TYPE referral_status AS ENUM (
    'pending',
    'approved',
    'rejected'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE programme_type AS ENUM ('DICT', 'BICT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE position_type AS ENUM ('tutor', 'demonstrator');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================
--  SETTINGS (singleton application window + screening config)
-- =============================================================

CREATE TABLE IF NOT EXISTS settings (
  id                    INTEGER PRIMARY KEY DEFAULT 1,
  min_average           NUMERIC(5,2) DEFAULT 75,
  module_pass_mark      NUMERIC(5,2) DEFAULT 70,
  cv_keywords           TEXT DEFAULT 'programming, database, SQL, networking, data structures, algorithms, web development, software engineering, system analysis, object oriented, Python, Java, HTML, CSS, JavaScript, Linux, operating systems, cybersecurity, data analytics, mobile development, tutoring, mentoring, teaching, communication, leadership, teamwork, problem solving, time management',
  min_cv_keywords       INTEGER DEFAULT 0,
  applications_open     BOOLEAN DEFAULT FALSE,
  closing_date          DATE,
  announcement_subject  TEXT DEFAULT 'Tutor Applications Now Open — 2026 Academic Year',
  announcement_body     TEXT DEFAULT
    'Dear Students,

Applications are now open for tutor positions for the 2026 academic year. To apply click the link below.

Closing date: {closing_date}

Kind regards,
Student Employment Office
University of Mpumalanga',
  rate_undergrad          NUMERIC(8,2) DEFAULT 70.00,
  rate_honours            NUMERIC(8,2) DEFAULT 85.00,
  rate_masters            NUMERIC(8,2) DEFAULT 100.00,
  max_hours_per_semester  INTEGER DEFAULT 160,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT settings_singleton CHECK (id = 1)
);

INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

UPDATE settings SET
  announcement_subject = 'Tutor Applications Now Open — 2026 Academic Year'
WHERE id = 1
  AND (announcement_subject IS NULL
    OR announcement_subject = 'Tutor Applications Now Open — 2026');

ALTER TABLE settings ADD COLUMN IF NOT EXISTS rate_undergrad NUMERIC(8,2) DEFAULT 70.00;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS rate_honours NUMERIC(8,2) DEFAULT 85.00;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS rate_masters NUMERIC(8,2) DEFAULT 100.00;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS max_hours_per_semester INTEGER DEFAULT 160;

-- =============================================================
--  STUDENTS (announcement email list)
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

CREATE INDEX IF NOT EXISTS idx_students_surname ON students (surname);
CREATE INDEX IF NOT EXISTS idx_students_email   ON students (email);

-- =============================================================
--  JOB POSTINGS
-- =============================================================

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

-- =============================================================
--  USERS
--  Single table for all three roles.
--  role column determines dashboard access.
-- =============================================================

CREATE TABLE users (
  id                    SERIAL PRIMARY KEY,
  student_number        VARCHAR(20)  UNIQUE,           -- tutors only; NULL for admin/lecturer
  title                 VARCHAR(10),                   -- Mr, Ms, Mrs, Miss, Dr, Prof
  initials              VARCHAR(10),
  first_names           VARCHAR(100) NOT NULL,
  surname               VARCHAR(100) NOT NULL,
  email                 VARCHAR(150) NOT NULL UNIQUE,
  cell                  VARCHAR(20),
  password_hash         VARCHAR(255) NOT NULL,
  role                  user_role    NOT NULL,
  temp_password_flag    BOOLEAN      NOT NULL DEFAULT FALSE,  -- lecturers: force reset on first login
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS residential_street TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS residential_city TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS residential_postal_code VARCHAR(10);
ALTER TABLE users ADD COLUMN IF NOT EXISTS residential_same_as_postal BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_document_filename TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tax_proof_filename TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_proof_filename TEXT;

-- Fast lookup by email (used on every login)
CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_users_role  ON users (role);

-- =============================================================
--  MESSAGING (lecturer ↔ tutor threads)
-- =============================================================

CREATE TABLE IF NOT EXISTS message_threads (
  id              SERIAL PRIMARY KEY,
  lecturer_id     INT          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  tutor_id        INT          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  module_code     VARCHAR(20)  NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (lecturer_id, tutor_id, module_code)
);

CREATE TABLE IF NOT EXISTS messages (
  id         SERIAL PRIMARY KEY,
  thread_id  INT          NOT NULL REFERENCES message_threads (id) ON DELETE CASCADE,
  sender_id  INT          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  subject    VARCHAR(255),
  body       TEXT         NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS message_thread_reads (
  thread_id     INT         NOT NULL REFERENCES message_threads (id) ON DELETE CASCADE,
  user_id       INT         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  last_read_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (thread_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_message_threads_lecturer ON message_threads (lecturer_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_threads_tutor ON message_threads (tutor_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages (thread_id, created_at ASC);

-- Coordinator (admin) messaging — separate from lecturer↔tutor peer threads
CREATE TABLE IF NOT EXISTS coordinator_threads (
  id              SERIAL PRIMARY KEY,
  peer_id         INT          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (peer_id)
);

CREATE TABLE IF NOT EXISTS coordinator_messages (
  id         SERIAL PRIMARY KEY,
  thread_id  INT          NOT NULL REFERENCES coordinator_threads (id) ON DELETE CASCADE,
  sender_id  INT          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  subject    VARCHAR(255),
  body       TEXT         NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coordinator_thread_reads (
  thread_id     INT         NOT NULL REFERENCES coordinator_threads (id) ON DELETE CASCADE,
  user_id       INT         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  last_read_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (thread_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_coordinator_threads_peer
  ON coordinator_threads (peer_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_coordinator_messages_thread
  ON coordinator_messages (thread_id, created_at ASC);

-- =============================================================
--  APPLICATIONS
--  One row per tutor application.
--  Created when tutor completes step 1 (account created).
--  Populated across steps 2 and 3.
-- =============================================================

CREATE TABLE applications (
  id                    SERIAL PRIMARY KEY,
  user_id               INT          NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  -- Step 2 fields
  faculty               VARCHAR(100),
  course                VARCHAR(100),
  qualification_level   qualification_level,
  module_year_level     VARCHAR(50),                   -- e.g. '2nd Year — Semester 1'
  module_name           VARCHAR(150),
  module_code           VARCHAR(20),
  gpa                   NUMERIC(5,2) CHECK (gpa >= 0 AND gpa <= 100),

  -- Step 3 fields
  cv_filename           VARCHAR(255),
  transcript_filename   VARCHAR(255),
  declared              BOOLEAN      NOT NULL DEFAULT FALSE,

  -- Automated screening (step 3 submit)
  cv_keyword_score      INT,
  screening_result      JSONB,

  -- Status & review
  status                application_status NOT NULL DEFAULT 'incomplete',
  rejection_reason      TEXT,                          -- populated on eligibility fail or rejection
  responsibility_level  responsibility_level,          -- set by admin at approval; drives pay rate
  assigned_lecturer_id  INT REFERENCES users (id),      -- auto-set at approval by matching course+module

  submitted_at          TIMESTAMPTZ,                   -- set when step 3 is submitted
  reviewed_at           TIMESTAMPTZ,                   -- set when admin takes action
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  UNIQUE (user_id)                                     -- one application per tutor
);

CREATE INDEX idx_applications_status  ON applications (status);
CREATE INDEX idx_applications_module  ON applications (module_name);
CREATE INDEX idx_applications_module_code ON applications (module_code);
CREATE INDEX idx_applications_user_id ON applications (user_id);
CREATE INDEX IF NOT EXISTS idx_applications_assigned_lecturer
  ON applications (assigned_lecturer_id)
  WHERE assigned_lecturer_id IS NOT NULL;

-- =============================================================
--  REFERRALS (lecturer nominate, admin approve)
-- =============================================================

CREATE TABLE IF NOT EXISTS referrals (
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

CREATE INDEX IF NOT EXISTS idx_referrals_lecturer ON referrals (lecturer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status   ON referrals (status);
CREATE INDEX IF NOT EXISTS idx_referrals_email    ON referrals (LOWER(email));

CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_pending_email_module
  ON referrals (LOWER(email), module_code)
  WHERE status = 'pending';

-- =============================================================
--  MODULES (official curriculum reference)
-- =============================================================

CREATE TABLE modules (
  code           VARCHAR(20) PRIMARY KEY,
  name           TEXT NOT NULL,
  course         programme_type NOT NULL,
  year_semester  VARCHAR(50) NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- DICT — Diploma in ICT (keep in sync with frontend/js/curriculum.js)
INSERT INTO modules (code, name, course, year_semester) VALUES
  ('COM100',  'Professional Communication 100', 'DICT', '1st Year — Semester 1'),
  ('DICT121', 'Computing Theory 121', 'DICT', '1st Year — Semester 1'),
  ('DICT131', 'Multimedia Fundamentals 131', 'DICT', '1st Year — Semester 1'),
  ('DICT151', 'Programming Fundamentals 151', 'DICT', '1st Year — Semester 1'),
  ('DICT111', 'Information Systems 111', 'DICT', '1st Year — Semester 1'),
  ('DICT112', 'Communication Network Fundamentals 112', 'DICT', '1st Year — Semester 2'),
  ('DICT122', 'Programming Fundamentals 122', 'DICT', '1st Year — Semester 2'),
  ('DICT132', 'Multimedia Fundamentals 132', 'DICT', '1st Year — Semester 2'),
  ('DICT142', 'Business Practice 142', 'DICT', '1st Year — Semester 2'),
  ('STAT101', 'Basic Statistics 101', 'DICT', '1st Year — Semester 2'),
  ('DICT211', 'Application Development 211', 'DICT', '2nd Year — Semester 1'),
  ('DICT221', 'Software Development 221', 'DICT', '2nd Year — Semester 1'),
  ('DICT231', 'IT Service Management 231', 'DICT', '2nd Year — Semester 1'),
  ('DICT241', 'Information Systems 241', 'DICT', '2nd Year — Semester 1'),
  ('DICT222', 'Application Development 222', 'DICT', '2nd Year — Semester 2'),
  ('DICT232', 'Communication Network 232', 'DICT', '2nd Year — Semester 2'),
  ('DICT242', 'Multimedia Applications 242', 'DICT', '2nd Year — Semester 2'),
  ('DICT252', 'IT Project Management 252', 'DICT', '2nd Year — Semester 2'),
  ('DICT311', 'Application Development 311', 'DICT', '3rd Year — Semester 1'),
  ('DICT321', 'Information Systems 321', 'DICT', '3rd Year — Semester 1'),
  ('DICT312', 'Application Development 312', 'DICT', '3rd Year — Semester 2'),
  ('DICT322', 'Information Systems 322', 'DICT', '3rd Year — Semester 2'),
  ('DICT300', 'Project 300', 'DICT', 'Year Block')
ON CONFLICT (code) DO NOTHING;

-- BICT — Bachelor of ICT
INSERT INTO modules (code, name, course, year_semester) VALUES
  ('ALP101',  'Academic Literacy and Professional Development for ICT 101', 'BICT', '1st Year — Semester 1'),
  ('DBF101',  'Introduction to Databases 101', 'BICT', '1st Year — Semester 1'),
  ('MFC101',  'Mathematics for Computing 101', 'BICT', '1st Year — Semester 1'),
  ('PRT101',  'Introduction to Programming Techniques 101', 'BICT', '1st Year — Semester 1'),
  ('CNT101',  'Introduction Communication Networking 101', 'BICT', '1st Year — Semester 1'),
  ('CPP102',  'Computing Professional Practice 102', 'BICT', '1st Year — Semester 2'),
  ('MFC102',  'Mathematics for Computing 102', 'BICT', '1st Year — Semester 2'),
  ('OSF102',  'Introduction to Operating Systems 102', 'BICT', '1st Year — Semester 2'),
  ('PRT102',  'Programming Techniques 102', 'BICT', '1st Year — Semester 2'),
  ('CNT102',  'Communication Networking 102', 'BICT', '1st Year — Semester 2'),
  ('PRT201',  'Programming Techniques 201', 'BICT', '2nd Year — Semester 1'),
  ('WDV201',  'Introduction to Web Development 201', 'BICT', '2nd Year — Semester 1'),
  ('PSE201',  'Principles of Software Engineering 201', 'BICT', '2nd Year — Semester 1'),
  ('DBS201',  'Database Systems 201', 'BICT', '2nd Year — Semester 1'),
  ('STF201',  'Statistics for Information Communication Technology 201', 'BICT', '2nd Year — Semester 1'),
  ('CYB202',  'Cybersecurity 202', 'BICT', '2nd Year — Semester 2'),
  ('MDT202',  'Mobile Application Development Techniques 202', 'BICT', '2nd Year — Semester 2'),
  ('IOT202',  'Introduction to the Internet of Things 202', 'BICT', '2nd Year — Semester 2'),
  ('DSA202',  'Data Structures and Algorithms 202', 'BICT', '2nd Year — Semester 2'),
  ('DSA202B', 'Data Scalability and Analytics 202', 'BICT', '2nd Year — Semester 2'),
  ('PRJ300',  'Project 300', 'BICT', '3rd Year — Semester 1'),
  ('IPM301',  'Information Technology Project Management 301', 'BICT', '3rd Year — Semester 1'),
  ('DAN301',  'Data Analytics 301', 'BICT', '3rd Year — Semester 1'),
  ('CYB302',  'Cybersecurity 302', 'BICT', '3rd Year — Semester 2'),
  ('PRG301',  'Programming Techniques 301', 'BICT', '3rd Year — Semester 2'),
  ('CNT302',  'Communication Networks 302', 'BICT', '3rd Year — Semester 2')
ON CONFLICT (code) DO NOTHING;

-- =============================================================
--  TUTOR PROFILES
--  Onboarding data collected after approval.
--  Separate from applications to keep concerns clean.
-- =============================================================

CREATE TABLE tutor_profiles (
  id                    SERIAL PRIMARY KEY,
  user_id               INT          NOT NULL REFERENCES users (id) ON DELETE CASCADE UNIQUE,

  -- Step 1: Identity
  id_number             VARCHAR(20),
  id_doc_filename       VARCHAR(255),

  -- Step 2: Address
  street_address        VARCHAR(200),
  city                  VARCHAR(100),
  province              VARCHAR(100),
  postal_code           VARCHAR(10),

  -- Step 2: Banking
  bank_name             VARCHAR(100),
  account_number        VARCHAR(30),
  account_type          VARCHAR(20),                   -- cheque, savings
  branch_code           VARCHAR(10),
  account_holder        VARCHAR(200),
  tax_number            VARCHAR(20),

  -- Completion flags (mirrors frontend onboarding.step1 / step2)
  step1_complete        BOOLEAN      NOT NULL DEFAULT FALSE,
  step2_complete        BOOLEAN      NOT NULL DEFAULT FALSE,

  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- =============================================================
--  LECTURER MODULES
--  Which lecturer is responsible for which module codes.
--  One lecturer can have many modules; one module has one lecturer.
-- =============================================================

CREATE TABLE lecturer_modules (
  id                    SERIAL PRIMARY KEY,
  lecturer_id           INT          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  course                VARCHAR(50)  NOT NULL,         -- 'BICT — Bachelor of ICT' | 'DICT — Diploma in ICT'
  module_code           VARCHAR(20)  NOT NULL,         -- lecturer's own real code, e.g. 'IS211' — informational only
  module_name           VARCHAR(150) NOT NULL,         -- MUST match a name in constants.js CURRICULUM for this course
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  UNIQUE (course, module_name)                         -- one lecturer per course+module, system-wide
);

CREATE INDEX idx_lec_modules_lecturer ON lecturer_modules (lecturer_id);
CREATE INDEX idx_lec_modules_code     ON lecturer_modules (module_code);

-- =============================================================
--  SESSIONS
--  Created by lecturers. Session codes are generated server-side
--  when the lecturer activates a session.
-- =============================================================

CREATE TABLE sessions (
  id                    SERIAL PRIMARY KEY,
  lecturer_id           INT          NOT NULL REFERENCES users (id),
  module_code           VARCHAR(20)  NOT NULL,
  topic                 VARCHAR(200),
  session_type          session_type NOT NULL,
  session_date          DATE         NOT NULL,
  start_time            TIME,
  end_time              TIME,
  venue                 VARCHAR(100),

  -- Attendance code (generated on activate, expires after session ends)
  session_code          VARCHAR(10)  UNIQUE,
  code_expires_at       TIMESTAMPTZ,

  status                session_status NOT NULL DEFAULT 'scheduled',
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_lecturer    ON sessions (lecturer_id);
CREATE INDEX idx_sessions_module      ON sessions (module_code);
CREATE INDEX idx_sessions_date        ON sessions (session_date);
CREATE INDEX idx_sessions_code        ON sessions (session_code);  -- used on every attendance POST
CREATE INDEX IF NOT EXISTS idx_sessions_lecturer_module_date
  ON sessions (lecturer_id, module_code, session_date DESC);

-- =============================================================
--  SESSION TUTORS
--  Many-to-many: which tutors are assigned to which sessions.
-- =============================================================

CREATE TABLE IF NOT EXISTS session_tutors (
  session_id            INT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  tutor_id              INT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  confirmed_at          TIMESTAMPTZ,
  declined_at           TIMESTAMPTZ,
  PRIMARY KEY (session_id, tutor_id)
);

CREATE INDEX IF NOT EXISTS idx_session_tutors_tutor_id ON session_tutors (tutor_id);

-- =============================================================
--  ATTENDANCE LOGS
--  One row per student per session.
--  Students are NOT in the users table — identified by student number only.
-- =============================================================

CREATE TABLE attendance_logs (
  id                    SERIAL PRIMARY KEY,
  session_id            INT          NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  student_number        VARCHAR(20)  NOT NULL,
  recorded_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  UNIQUE (session_id, student_number)               -- prevent duplicate check-ins
);

CREATE INDEX idx_attendance_session ON attendance_logs (session_id);

-- =============================================================
--  CLASS LIST ENTRIES
--  Per-module student roster for attendance validation.
-- =============================================================

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

-- =============================================================
--  SESSION QR TOKENS & ATTENDANCE PASSES
--  Rotating QR tokens and long-lived passes for student sign-in.
-- =============================================================

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

-- Backward-compatible column add for existing databases
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS end_time TIME;

-- =============================================================
--  CLAIMS
--  One claim per tutor per month.
--  A claim covers multiple sessions (line items in claim_sessions).
-- =============================================================

CREATE TABLE claims (
  id                      SERIAL PRIMARY KEY,
  tutor_id                INT          NOT NULL REFERENCES users (id),
  lecturer_id             INT          NOT NULL REFERENCES users (id),
  module_code             VARCHAR(20)  NOT NULL,
  period_month            INT          NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year             INT          NOT NULL,
  total_hours             NUMERIC(6,2) NOT NULL DEFAULT 0,
  pay_rate                NUMERIC(8,2),
  total_amount            NUMERIC(10,2),
  status                  claim_status NOT NULL DEFAULT 'pending_lecturer',
  lecturer_note           TEXT,
  coordinator_note        TEXT,
  submitted_at            TIMESTAMPTZ  DEFAULT NOW(),
  lecturer_reviewed_at    TIMESTAMPTZ,
  coordinator_reviewed_at TIMESTAMPTZ,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  UNIQUE (tutor_id, module_code, period_month, period_year)
);

CREATE INDEX idx_claims_tutor    ON claims (tutor_id);
CREATE INDEX idx_claims_lecturer ON claims (lecturer_id);
CREATE INDEX idx_claims_status   ON claims (status);
CREATE INDEX IF NOT EXISTS idx_claims_tutor_module_period
  ON claims (tutor_id, module_code, period_year DESC, period_month DESC);

-- =============================================================
--  CLAIM SESSIONS
--  Line items: each session included in a claim.
--  Rate is snapshotted at submission time so future rate changes
--  do not alter historical claims.
-- =============================================================

CREATE TABLE claim_sessions (
  id              SERIAL PRIMARY KEY,
  claim_id        INT          NOT NULL REFERENCES claims (id) ON DELETE CASCADE,
  session_id      INT          NOT NULL REFERENCES sessions (id),
  claimed_hours   NUMERIC(5,2) NOT NULL DEFAULT 2,
  included        BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  UNIQUE (claim_id, session_id)
);

CREATE INDEX idx_claim_sessions_claim ON claim_sessions (claim_id);

-- =============================================================
--  SYSTEM SETTINGS
--  Admin-configurable eligibility and CV keyword screening.
-- =============================================================

CREATE TABLE system_settings (
  key         VARCHAR(100) PRIMARY KEY,
  value       TEXT         NOT NULL,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO system_settings (key, value) VALUES
  ('cv_keywords',      'programming, database, SQL, networking, data structures, algorithms, web development, software engineering, system analysis, object oriented, Python, Java, HTML, CSS, JavaScript, Linux, operating systems, cybersecurity, data analytics, mobile development, tutoring, mentoring, teaching, communication, leadership, teamwork, problem solving, time management'),
  ('min_average',      '75'),
  ('module_pass_mark', '70'),
  ('min_cv_keywords',  '0');

-- =============================================================
--  SUPPORT TICKETS
-- =============================================================

CREATE TABLE IF NOT EXISTS support_tickets (
  id SERIAL PRIMARY KEY,
  created_by_id INTEGER NOT NULL REFERENCES users(id),
  created_by_role VARCHAR(20) NOT NULL,
  subject TEXT NOT NULL,
  details TEXT NOT NULL,
  priority VARCHAR(10) NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high')),
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'resolved')),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_ticket_replies (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES support_tickets(id)
    ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id),
  author_role VARCHAR(20) NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================
--  AUTO-UPDATE updated_at TRIGGER
--  Applied to every table that has an updated_at column.
-- =============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_applications_updated_at
  BEFORE UPDATE ON applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_tutor_profiles_updated_at
  BEFORE UPDATE ON tutor_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_sessions_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_claims_updated_at
  BEFORE UPDATE ON claims
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_class_list_updated_at ON class_list_entries;
CREATE TRIGGER trg_class_list_updated_at
  BEFORE UPDATE ON class_list_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_referrals_updated_at ON referrals;
CREATE TRIGGER trg_referrals_updated_at
  BEFORE UPDATE ON referrals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_support_tickets_updated_at ON support_tickets;
CREATE TRIGGER trg_support_tickets_updated_at
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_settings_updated_at ON settings;
CREATE TRIGGER trg_settings_updated_at
  BEFORE UPDATE ON settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_postings_updated_at ON postings;
CREATE TRIGGER trg_postings_updated_at
  BEFORE UPDATE ON postings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();