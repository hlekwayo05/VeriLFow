-- =============================================================
--  VeriFlow — Seed Script
--  Run AFTER schema.sql.
--  psql -U postgres -d veriflow -f seed.sql
--
--  Passwords shown in comments — change before any real deployment.
-- =============================================================

-- =============================================================
--  ADMIN ACCOUNT
--  Password: Admin@VeriFlow2026
--  Hash generated with bcrypt cost 12.
--  To regenerate: node -e "const b=require('bcrypt');b.hash('Admin@VeriFlow2026',12).then(console.log)"
-- =============================================================

INSERT INTO users (
  first_names, surname, email, password_hash, role
)
VALUES (
  'FYE', 'Coordinator',
  'fye@ump.ac.za',
  '$2b$12$placeholderHashReplaceBeforeDeployment000000000000000000',
  'admin'
)
ON CONFLICT (email) DO NOTHING;

-- =============================================================
--  SAMPLE LECTURER ACCOUNT (for development/demo only)
--  Password: Temp1234  (temp_password_flag = TRUE → forced reset on first login)
-- =============================================================

INSERT INTO users (
  first_names, surname, email, cell,
  password_hash, role, temp_password_flag
)
VALUES (
  'Dr Sipho', 'Mahlangu',
  'smahlangu@ump.ac.za',
  '0137723001',
  '$2b$12$placeholderHashReplaceBeforeDeployment000000000000000000',
  'lecturer',
  TRUE
)
ON CONFLICT (email) DO NOTHING;

-- Assign modules to the sample lecturer
INSERT INTO lecturer_modules (lecturer_id, module_code, module_name)
SELECT
  u.id,
  m.code,
  m.name
FROM users u
CROSS JOIN (VALUES
  ('IS211',  'Information Systems 211'),
  ('APD301', 'Applications Development 301'),
  ('IS310',  'Information Systems 310')
) AS m(code, name)
WHERE u.email = 'smahlangu@ump.ac.za'
ON CONFLICT (lecturer_id, module_code) DO NOTHING;

-- =============================================================
--  SAMPLE TUTOR ACCOUNTS (for development/demo only)
--  Password for all: Tutor1234
-- =============================================================

INSERT INTO users (
  student_number, title, initials, first_names, surname,
  email, cell, password_hash, role
)
VALUES
  ('220012345', 'Ms',  'C N', 'Carol',  'Nkosi',
   'cnkosi@ump.ac.za',   '0821234567',
   '$2b$12$placeholderHashReplaceBeforeDeployment000000000000000000',
   'tutor'),
  ('210098765', 'Mr',  'T D', 'Thabo',  'Dlamini',
   'tdlamini@ump.ac.za', '0837654321',
   '$2b$12$placeholderHashReplaceBeforeDeployment000000000000000000',
   'tutor'),
  ('220055512', 'Ms',  'B M', 'Bongi',  'Masondo',
   'bmasondo@ump.ac.za', '0849876543',
   '$2b$12$placeholderHashReplaceBeforeDeployment000000000000000000',
   'tutor')
ON CONFLICT (email) DO NOTHING;

-- Sample applications for the demo tutors
INSERT INTO applications (
  user_id, faculty, course, qualification_level,
  module_year_level, module_name, gpa,
  cv_filename, transcript_filename, declared,
  status, submitted_at
)
SELECT
  u.id,
  a.faculty,
  a.course,
  a.qual::qualification_level,
  a.year_level,
  a.module,
  a.gpa,
  a.cv,
  a.transcript,
  TRUE,
  a.status::application_status,
  NOW()
FROM (VALUES
  ('cnkosi@ump.ac.za',   'Information & Communication Technology', 'DICT — Diploma in ICT',
   '4th_year_honours', '2nd Year — Semester 1', 'Information Systems', 82.5,
   'cv_cnkosi.pdf', 'transcript_cnkosi.pdf', 'approved'),
  ('tdlamini@ump.ac.za', 'Information & Communication Technology', 'DICT — Diploma in ICT',
   '3rd_year',        '2nd Year — Semester 1', 'Application Development', 78.0,
   'cv_tdlamini.pdf', 'transcript_tdlamini.pdf', 'approved'),
  ('bmasondo@ump.ac.za', 'Information & Communication Technology', 'DICT — Diploma in ICT',
   '3rd_year',        '3rd Year — Semester 1 & 2', 'Information Systems', 76.0,
   'cv_bmasondo.pdf', 'transcript_bmasondo.pdf', 'shortlisted')
) AS a(email, faculty, course, qual, year_level, module, gpa, cv, transcript, status)
JOIN users u ON u.email = a.email
ON CONFLICT (user_id) DO NOTHING;

-- Onboarding profiles for approved tutors
INSERT INTO tutor_profiles (
  user_id,
  step1_complete, step2_complete
)
SELECT u.id, TRUE, TRUE
FROM users u
WHERE u.email IN ('cnkosi@ump.ac.za', 'tdlamini@ump.ac.za')
ON CONFLICT (user_id) DO NOTHING;

-- =============================================================
--  SAMPLE SESSIONS (for development/demo only)
-- =============================================================

INSERT INTO sessions (
  lecturer_id, module_code, topic, session_type,
  session_date, start_time, venue, status
)
SELECT
  u.id,
  s.module_code,
  s.topic,
  s.stype::session_type,
  s.sdate::DATE,
  s.stime::TIME,
  s.venue,
  s.status::session_status
FROM users u
CROSS JOIN (VALUES
  ('IS211', 'Database Normalisation & ER Diagrams', 'practical', '2026-01-28', '10:00', 'Lab 2B',    'completed'),
  ('IS211', 'SQL Queries & Joins',                  'online',    '2026-01-30', '14:00', 'Online',    'completed'),
  ('IS211', 'Systems Analysis & Design',            'practical', '2026-02-03', '10:00', 'Lab 4B',    'scheduled'),
  ('APD301','Application Architecture Intro',       'lecture',   '2026-02-05', '09:00', 'Hall A',    'scheduled')
) AS s(module_code, topic, stype, sdate, stime, venue, status)
WHERE u.email = 'smahlangu@ump.ac.za'
ON CONFLICT DO NOTHING;