-- Migration 018: allow lecturers to cancel sessions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'session_status'
      AND e.enumlabel = 'cancelled'
  ) THEN
    ALTER TYPE session_status ADD VALUE 'cancelled';
  END IF;
END $$;
