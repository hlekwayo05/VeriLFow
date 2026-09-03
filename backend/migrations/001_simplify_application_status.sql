-- =============================================================
--  Migration 001 - Simplify application_status
--
--  Reason: lecturers do not review tutor applications. Admin is
--  the sole reviewer. The pipeline is now:
--    submitted -> under_review -> approved | rejected
--
--  Removed values: 'shortlisted', 'rejected_lec'
--  (no longer reachable from any route after this change)
--
--  PostgreSQL cannot drop a value from an existing ENUM type
--  directly, so this rebuilds the type and re-points the column.
--
--  Run once:
--  psql -U postgres -d veriflow -f migrations/001_simplify_application_status.sql
-- =============================================================

BEGIN;

-- Safety check - if any row is currently using a value we're about
-- to remove, stop the migration rather than silently losing data.
DO $$
DECLARE
  stuck_count INT;
BEGIN
  SELECT COUNT(*) INTO stuck_count
  FROM applications
  WHERE status IN ('shortlisted', 'rejected_lec');

  IF stuck_count > 0 THEN
    RAISE EXCEPTION
      'Migration aborted: % application(s) still use shortlisted/rejected_lec. Resolve these manually first.',
      stuck_count;
  END IF;
END $$;

-- 1. Create the new, smaller ENUM under a temporary name
CREATE TYPE application_status_new AS ENUM (
  'incomplete',
  'submitted',
  'under_review',
  'approved',
  'rejected'
);

-- 2. Swap the column over to the new type
ALTER TABLE applications
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE application_status_new
    USING status::text::application_status_new,
  ALTER COLUMN status SET DEFAULT 'incomplete';

-- 3. Drop the old type and rename the new one into its place
DROP TYPE application_status;
ALTER TYPE application_status_new RENAME TO application_status;

-- 4. Drop lecturer_rank - no longer needed since lecturers do not
--    rank or review applications in any capacity.
ALTER TABLE applications DROP COLUMN IF EXISTS lecturer_rank;

COMMIT;