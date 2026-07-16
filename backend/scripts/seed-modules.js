'use strict';

/**
 * Load official curriculum into the modules table.
 * Safe to re-run (ON CONFLICT DO NOTHING).
 *
 * Usage (from backend/):
 *   npm run db:modules
 */

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const pool = require('../db');

async function main() {
  const sqlPath = path.join(__dirname, '..', 'migrations', '009_modules_curriculum.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log('Seeding modules curriculum…');
  await pool.query(sql);
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM modules');
  console.log(`Done. modules count: ${rows[0].n}`);
}

main()
  .catch((err) => {
    console.error('db:modules failed:', err.message);
    process.exit(1);
  })
  .finally(() => pool.end());
