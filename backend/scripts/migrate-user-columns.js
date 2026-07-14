'use strict';

/**
 * One-time migration: users residential + onboarding document columns.
 * Safe to run multiple times (IF NOT EXISTS).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db');

const SQL = `
ALTER TABLE users ADD COLUMN IF NOT EXISTS residential_street TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS residential_city TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS residential_postal_code VARCHAR(10);
ALTER TABLE users ADD COLUMN IF NOT EXISTS residential_same_as_postal BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_document_filename TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tax_proof_filename TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_proof_filename TEXT;
`;

async function main() {
  try {
    await pool.query(SQL);
    const check = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'users'
        AND column_name IN (
          'residential_street',
          'residential_city',
          'residential_postal_code',
          'residential_same_as_postal',
          'id_document_filename',
          'tax_proof_filename',
          'bank_proof_filename'
        )
      ORDER BY column_name
    `);
    console.log('Migration complete. users columns:', check.rows.map((r) => r.column_name));
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
