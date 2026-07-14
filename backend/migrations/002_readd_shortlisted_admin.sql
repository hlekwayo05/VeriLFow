-- =============================================================
--  Migration 002 — Reintroduce 'shortlisted' (admin-controlled)
--
--  Context: Migration 001 removed 'shortlisted' and 'rejected_lec'
--  because lecturers do not review applications. That decision
--  stands — lecturers still have no review role.
--
--  However, the admin-only pipeline does need an intermediate
--  shortlist stage:
--    submitted -> under_review -> shortlisted -> approved | rejected
--
--  'rejected_lec' and lecturer_rank remain removed — there is still
--  no lecturer involvement, only the admin now performs the
--  shortlisting action that was previously (incorrectly) modelled
--  as a lecturer action.
--
--  Run once:
--  psql -U postgres -d veriflow -f migrations/002_readd_shortlisted_admin.sql
-- =============================================================

BEGIN;

-- 1. Create the new ENUM under a temporary name, with shortlisted restored
CREATE TYPE application_status_new AS ENUM (
  'incomplete',
  'submitted',
  'under_review',
  'shortlisted',
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

COMMIT;