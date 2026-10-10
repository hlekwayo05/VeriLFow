-- Migration 031 - Referral position type
-- Lecturers refer a student as a tutor or a demonstrator; approval copies
-- the choice onto the student's application.

ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS position_type VARCHAR(20) NOT NULL DEFAULT 'tutor';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'referrals_position_type_check'
  ) THEN
    ALTER TABLE referrals
      ADD CONSTRAINT referrals_position_type_check
      CHECK (position_type IN ('tutor', 'demonstrator'));
  END IF;
END $$;
