-- Migration 032 - Session flag reasons and outcomes
-- Records when a session actually ran, why it was flagged, and how the admin
-- resolved it. Rejected sessions stay 'completed' but cannot be claimed.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS activated_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS flag_reasons  TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS flag_outcome  VARCHAR(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sessions_flag_outcome_check'
  ) THEN
    ALTER TABLE sessions
      ADD CONSTRAINT sessions_flag_outcome_check
      CHECK (flag_outcome IS NULL OR flag_outcome IN ('approved', 'warned', 'rejected'));
  END IF;
END $$;

-- Sessions flagged before this migration were all "no tutor confirmed".
UPDATE sessions
   SET flag_reasons = ARRAY['no_tutor_confirmed']
 WHERE status = 'flagged'
   AND flag_reasons = '{}';
