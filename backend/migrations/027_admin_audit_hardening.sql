-- Admin audit hardening: persist flag resolution notes; unique staff numbers when set.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS flag_resolution_note TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_staff_number_unique
  ON users (staff_number)
  WHERE staff_number IS NOT NULL AND BTRIM(staff_number) <> '';
