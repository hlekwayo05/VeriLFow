'use strict';

/**
 * One-time migration: support_tickets + support_ticket_replies
 * Safe to run multiple times (IF NOT EXISTS).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db');

const SQL = `
CREATE TABLE IF NOT EXISTS support_tickets (
  id SERIAL PRIMARY KEY,
  created_by_id INTEGER NOT NULL REFERENCES users(id),
  created_by_role VARCHAR(20) NOT NULL,
  subject TEXT NOT NULL,
  details TEXT NOT NULL,
  priority VARCHAR(10) NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high')),
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'resolved')),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_ticket_replies (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES support_tickets(id)
    ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id),
  author_role VARCHAR(20) NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_support_tickets_updated_at ON support_tickets;
CREATE TRIGGER trg_support_tickets_updated_at
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
`;

async function main() {
  try {
    await pool.query(SQL);
    const reg = await pool.query(
      "SELECT to_regclass('public.support_tickets') AS tickets, to_regclass('public.support_ticket_replies') AS replies"
    );
    console.log('Migration complete:', reg.rows[0]);
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
