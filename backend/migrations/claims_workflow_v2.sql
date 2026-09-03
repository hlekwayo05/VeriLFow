-- Claims workflow v2 - run once against Supabase PostgreSQL
-- Drops existing claims data and recreates tables with the new workflow schema.

DROP TABLE IF EXISTS claim_sessions CASCADE;
DROP TABLE IF EXISTS claims CASCADE;

DROP TYPE IF EXISTS claim_status CASCADE;

CREATE TYPE claim_status AS ENUM (
  'pending_lecturer',
  'pending_coordinator',
  'approved',
  'returned_by_lecturer',
  'returned_by_coordinator'
);

CREATE TABLE claims (
  id SERIAL PRIMARY KEY,
  tutor_id INTEGER NOT NULL REFERENCES users(id),
  lecturer_id INTEGER NOT NULL REFERENCES users(id),
  module_code VARCHAR(20) NOT NULL,
  period_month INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year INTEGER NOT NULL,
  total_hours NUMERIC(6,2) NOT NULL DEFAULT 0,
  pay_rate NUMERIC(8,2),
  total_amount NUMERIC(10,2),
  status claim_status NOT NULL DEFAULT 'pending_lecturer',
  lecturer_note TEXT,
  coordinator_note TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  lecturer_reviewed_at TIMESTAMPTZ,
  coordinator_reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tutor_id, module_code, period_month, period_year)
);

CREATE INDEX idx_claims_tutor ON claims (tutor_id);
CREATE INDEX idx_claims_lecturer ON claims (lecturer_id);
CREATE INDEX idx_claims_status ON claims (status);
CREATE INDEX idx_claims_module ON claims (module_code);

CREATE TABLE claim_sessions (
  id SERIAL PRIMARY KEY,
  claim_id INTEGER NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  claimed_hours NUMERIC(5,2) NOT NULL DEFAULT 2,
  included BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(claim_id, session_id)
);

CREATE INDEX idx_claim_sessions_claim ON claim_sessions (claim_id);

CREATE TRIGGER trg_claims_updated_at
  BEFORE UPDATE ON claims
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
