-- CHANGE 1 - simplified HR document filename columns on applications
ALTER TABLE applications ADD COLUMN IF NOT EXISTS id_filename TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS tax_filename TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS bank_filename TEXT;

-- Backfill from earlier 024 column names when present
UPDATE applications SET id_filename = id_copy_filename
  WHERE id_filename IS NULL AND id_copy_filename IS NOT NULL;
UPDATE applications SET tax_filename = tax_proof_filename
  WHERE tax_filename IS NULL AND tax_proof_filename IS NOT NULL;
UPDATE applications SET bank_filename = bank_proof_filename
  WHERE bank_filename IS NULL AND bank_proof_filename IS NOT NULL;

-- CHANGE 2 - appointment configuration settings
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS appointment_start_date DATE DEFAULT '2026-02-01';
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS appointment_end_date DATE DEFAULT '2026-12-31';
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS director_email TEXT DEFAULT 'Mabizweni.machava@ump.ac.za';
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS school_approver_name TEXT DEFAULT 'Prof. Wayi';
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS ucdg_approver_name TEXT DEFAULT 'Mr. Machava';

-- Ensure director defaults align with Form D / Confirmation Form
ALTER TABLE settings ADD COLUMN IF NOT EXISTS director_name TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS director_title TEXT;

UPDATE settings SET
  appointment_start_date = COALESCE(appointment_start_date, appointment_period_start, '2026-02-01'),
  appointment_end_date   = COALESCE(appointment_end_date, appointment_period_end, '2026-12-31'),
  director_name          = COALESCE(NULLIF(TRIM(director_name), ''), 'Dr M Madiope'),
  director_title         = COALESCE(
    NULLIF(TRIM(director_title), ''),
    'Director: Academic Support Services Division'
  ),
  director_email         = COALESCE(NULLIF(TRIM(director_email), ''), 'Mabizweni.machava@ump.ac.za'),
  school_approver_name   = COALESCE(NULLIF(TRIM(school_approver_name), ''), 'Prof. Wayi'),
  ucdg_approver_name     = COALESCE(NULLIF(TRIM(ucdg_approver_name), ''), 'Mr. Machava')
WHERE id = 1;

-- CHANGE 5 - HR staff number
ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_number VARCHAR(20);
