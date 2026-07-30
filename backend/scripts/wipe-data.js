'use strict';

/**
 * Wipe all application data from the public schema.
 * Keeps tables/schema; truncates every public table and resets identities.
 *
 * Usage (from backend/):
 *   node scripts/wipe-data.js
 *
 * After wipe, re-seed if needed:
 *   node seed.js
 *   npm run db:modules
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const pool = require('../db');

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set in backend/.env');
  }

  const client = await pool.connect();
  try {
    const { rows: tables } = await client.query(
      `SELECT tablename
       FROM pg_tables
       WHERE schemaname = 'public'
       ORDER BY tablename`
    );

    if (!tables.length) {
      console.log('No public tables found — database is already empty of schema.');
      return;
    }

    console.log(`Found ${tables.length} public tables. Truncating…`);

    // One TRUNCATE with CASCADE clears FK-linked rows in dependency order.
    const qualified = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
    await client.query(`TRUNCATE TABLE ${qualified} RESTART IDENTITY CASCADE`);

    console.log('All public tables emptied (identities reset).');

    // Confirm a few high-signal counts
    for (const name of ['users', 'applications', 'sessions', 'students', 'modules']) {
      const exists = tables.some((t) => t.tablename === name);
      if (!exists) continue;
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM "public"."${name}"`);
      console.log(`  ${name}: ${rows[0].n}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Wipe failed:', err.message);
  process.exit(1);
});
