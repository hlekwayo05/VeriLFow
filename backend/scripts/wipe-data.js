'use strict';

/**
 * Remove user accounts and related operational data.
 * Keeps reference/config data: modules, students roster, settings, postings.
 *
 * Usage (from backend/):
 *   node scripts/wipe-data.js
 *
 * Full schema wipe (dangerous — empties EVERYTHING including modules):
 *   node scripts/wipe-data.js --all
 *
 * After a users wipe, re-seed admin if needed:
 *   node seed.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const pool = require('../db');

/** Tables that must survive a normal (users-only) wipe. */
const PRESERVE = new Set([
  'modules',
  'students',
  'settings',
  'system_settings',
  'postings',
]);

async function wipeAll(client) {
  const { rows: tables } = await client.query(
    `SELECT tablename
     FROM pg_tables
     WHERE schemaname = 'public'
     ORDER BY tablename`
  );

  if (!tables.length) {
    console.log('No public tables found.');
    return;
  }

  const qualified = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await client.query(`TRUNCATE TABLE ${qualified} RESTART IDENTITY CASCADE`);
  console.log(`Full wipe: truncated ${tables.length} public tables.`);
}

async function wipeUsersOnly(client) {
  const { rows: tables } = await client.query(
    `SELECT tablename
     FROM pg_tables
     WHERE schemaname = 'public'
     ORDER BY tablename`
  );

  const toWipe = tables
    .map((t) => t.tablename)
    .filter((name) => !PRESERVE.has(name));

  if (!toWipe.length) {
    console.log('Nothing to wipe.');
    return;
  }

  // Clear FKs that point at users but are NOT ON DELETE CASCADE.
  await client.query(`UPDATE applications SET assigned_lecturer_id = NULL`);
  await client.query(`UPDATE referrals SET reviewed_by = NULL WHERE reviewed_by IS NOT NULL`);

  const qualified = toWipe.map((name) => `"public"."${name}"`).join(', ');
  await client.query(`TRUNCATE TABLE ${qualified} RESTART IDENTITY CASCADE`);

  console.log('Users wipe complete. Truncated:');
  for (const name of toWipe) console.log(`  - ${name}`);
  console.log('Preserved:');
  for (const name of [...PRESERVE].sort()) {
    if (!tables.some((t) => t.tablename === name)) continue;
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM "public"."${name}"`);
    console.log(`  - ${name}: ${rows[0].n}`);
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set in backend/.env');
  }

  const fullWipe = process.argv.includes('--all');
  const client = await pool.connect();
  try {
    if (fullWipe) {
      console.log('WARNING: --all empties every public table (including modules/students/settings).');
      await wipeAll(client);
    } else {
      await wipeUsersOnly(client);
    }

    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM users`
    );
    console.log(`users remaining: ${rows[0].n}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Wipe failed:', err.message);
  process.exit(1);
});
