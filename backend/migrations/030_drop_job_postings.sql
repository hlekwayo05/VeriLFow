-- Migration 030 - Drop job postings
-- Applications already store module_code, module_name, position_type,
-- and course/faculty. There is no posting_id FK in production schema;
-- DROP COLUMN IF EXISTS is here in case a local copy added one.
-- Safe to run on existing data: no application rows are deleted.

ALTER TABLE applications DROP COLUMN IF EXISTS posting_id;

DROP TABLE IF EXISTS postings CASCADE;
