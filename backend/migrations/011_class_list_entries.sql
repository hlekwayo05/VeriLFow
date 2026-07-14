-- Migration 011: class list entries per module (lecturer attendance validation)

CREATE TABLE IF NOT EXISTS class_list_entries (
  id              SERIAL PRIMARY KEY,
  module_code     VARCHAR(20)  NOT NULL,
  student_number  VARCHAR(20)  NOT NULL,
  full_name       TEXT         NOT NULL,
  year_level      VARCHAR(20),
  status          VARCHAR(20)  NOT NULL DEFAULT 'Active',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (module_code, student_number)
);

CREATE INDEX IF NOT EXISTS idx_class_list_module ON class_list_entries (module_code);

DROP TRIGGER IF EXISTS trg_class_list_updated_at ON class_list_entries;
CREATE TRIGGER trg_class_list_updated_at
  BEFORE UPDATE ON class_list_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
