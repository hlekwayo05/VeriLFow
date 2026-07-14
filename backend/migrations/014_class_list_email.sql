-- Migration 014: store student email on class list entries

ALTER TABLE class_list_entries
  ADD COLUMN IF NOT EXISTS email VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_class_list_email ON class_list_entries (email);
