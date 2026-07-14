-- Ensure approved tutors have a tutor_profiles row (fixes masana, waka, etc.)
INSERT INTO tutor_profiles (user_id, step1_complete, step2_complete)
SELECT a.user_id, FALSE, FALSE
FROM applications a
WHERE a.status = 'approved'
ON CONFLICT (user_id) DO NOTHING;

ALTER TABLE tutor_profiles
  ADD COLUMN IF NOT EXISTS tax_number VARCHAR(20);

ALTER TABLE tutor_profiles
  ADD COLUMN IF NOT EXISTS account_holder VARCHAR(200);
