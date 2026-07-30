'use strict';

/**
 * Apply safe additive migrations that schema.sql may omit on fresh installs.
 * Usage: npm run db:migrate-pending
 */

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const pool = require('../db');

const FILES = [
  '010_session_tutor_confirmation.sql',
  '013_tutor_onboarding_persist.sql',
  '014_class_list_email.sql',
  '016_end_time_and_qr_tables.sql',
  '017_session_tutors_tutor_index.sql',
  '018_session_cancelled_status.sql',
  '019_perf_indexes_partition.sql',
];

async function main() {
  for (const file of FILES) {
    const full = path.join(__dirname, '..', 'migrations', file);
    const sql = fs.readFileSync(full, 'utf8');
    console.log(`Applying ${file}…`);
    await pool.query(sql);
    console.log(`  OK ${file}`);
  }

  const cols = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tutor_profiles'
      AND column_name IN ('account_holder', 'tax_number')
    ORDER BY column_name
  `);
  console.log(
    'tutor_profiles columns:',
    cols.rows.map((r) => r.column_name).join(', ') || '(missing)'
  );
}

main()
  .catch((err) => {
    console.error('migrate-pending failed:', err.message);
    process.exit(1);
  })
  .finally(() => pool.end());
