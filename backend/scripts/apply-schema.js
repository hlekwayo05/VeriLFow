'use strict';

/**
 * Apply backend/schema.sql to the database in DATABASE_URL.
 *
 * Usage (from backend/):
 *   npm run db:schema
 *
 * Intended for a fresh empty database (e.g. new Supabase project).
 * Re-running against a DB that already has VeriFlow types/tables will fail.
 */

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = require('../db');

async function main() {
  const schemaPath = path.join(__dirname, '..', 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`schema.sql not found at ${schemaPath}`);
  }

  const sql = fs.readFileSync(schemaPath, 'utf8');

  console.log('Applying schema.sql to DATABASE_URL…');
  try {
    await pool.query(sql);
    console.log('Schema applied successfully.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Schema apply failed:', err.message);
  process.exit(1);
});
