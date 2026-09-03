-- =============================================================
--  Migration 003 - Link tutors to lecturers via course + module
--
--  Context: a lecturer can teach multiple modules; a tutor applies
--  for exactly one module within one course (BICT or DICT). When
--  admin approves a tutor, the system must automatically know
--  which lecturer that tutor reports to.
--
--  This requires lecturer_modules to record WHICH COURSE a module
--  belongs to (since the same module name, e.g. "Programming",
--  exists independently in both BICT and DICT with different
--  lecturers and different students) and to be picked from the
--  same official curriculum list tutors apply against - not
--  free text - so the match is always reliable.
--
--  Changes:
--  1. lecturer_modules gains a `course` column
--  2. lecturer_modules gains UNIQUE (course, module_name) -
--     one lecturer per course+module combination, system-wide
--  3. applications gains `assigned_lecturer_id`, set automatically
--     at approval time by matching course + module_name
--
--  Run once:
--  psql -U postgres -d veriflow -f migrations/003_link_tutors_to_lecturers.sql
-- =============================================================

BEGIN;

-- 1. Add course column to lecturer_modules.
--    Existing seed rows (IS211, APD301, IS310) are free-text codes
--    entered before this rule existed - backfill them as DICT
--    since UMP's seed lecturer (Dr Mahlangu) teaches DICT modules.
ALTER TABLE lecturer_modules
  ADD COLUMN course VARCHAR(50);

UPDATE lecturer_modules
  SET course = 'DICT - Diploma in ICT'
  WHERE course IS NULL;

ALTER TABLE lecturer_modules
  ALTER COLUMN course SET NOT NULL;

-- 2. Enforce one lecturer per course+module combination.
--    Drop the old (lecturer_id, module_code) uniqueness - a single
--    lecturer's own code is no longer the uniqueness boundary,
--    the course+module_name pairing is.
ALTER TABLE lecturer_modules
  DROP CONSTRAINT IF EXISTS lecturer_modules_lecturer_id_module_code_key;

ALTER TABLE lecturer_modules
  ADD CONSTRAINT lecturer_modules_course_module_name_key UNIQUE (course, module_name);

-- 3. Add assigned_lecturer_id to applications - set automatically
--    when admin approves a tutor, by matching course + module_name
--    against lecturer_modules. Nullable: not every application
--    reaches approval, and older approved rows had no lecturer
--    link before this migration (left NULL, admin can re-save
--    approval if needed to backfill).
ALTER TABLE applications
  ADD COLUMN assigned_lecturer_id INT REFERENCES users (id);

COMMIT;