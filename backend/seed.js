/*
 * SEED SCRIPT - development only
 * Never commit real passwords to source control.
 * Set ADMIN_SEED_PASSWORD in .env before running.
 * Run with: node backend/seed.js
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const pool = require('./db');
const bcrypt = require('bcrypt');

const COST = 12;

const adminPassword = process.env.ADMIN_SEED_PASSWORD;
if (!adminPassword) {
  console.error(
    'ADMIN_SEED_PASSWORD is not set in .env - ' +
    'cannot seed admin account safely'
  );
  process.exit(1);
}

/** Production admin - change email here only when intentionally rotating. */
const ADMIN = {
  first_names: 'VeriFlow',
  surname: 'Coordinator',
  email: 'veriflow@ump.ac.za',
};

const DEMO_EMAILS = [
  'fye@ump.ac.za',
  'smahlangu@ump.ac.za',
  'cnkosi@ump.ac.za',
  'tdlamini@ump.ac.za',
  'bmasondo@ump.ac.za',
];

async function removeDemoUsers(client) {
  const { rows } = await client.query(
    `SELECT id, email, role FROM users WHERE email = ANY($1::text[])`,
    [DEMO_EMAILS]
  );
  if (!rows.length) return;

  const ids = rows.map((r) => r.id);
  const tutorIds = rows.filter((r) => r.role === 'tutor').map((r) => r.id);
  const lecIds = rows.filter((r) => r.role === 'lecturer').map((r) => r.id);

  // Clear FKs that may point at demo users (order matters)
  if (tutorIds.length) {
    await client.query(`DELETE FROM session_tutors WHERE tutor_id = ANY($1::int[])`, [tutorIds]);
    await client.query(`DELETE FROM tutor_profiles WHERE user_id = ANY($1::int[])`, [tutorIds]);
    await client.query(`DELETE FROM applications WHERE user_id = ANY($1::int[])`, [tutorIds]);
  }
  if (lecIds.length) {
    await client.query(`DELETE FROM sessions WHERE lecturer_id = ANY($1::int[])`, [lecIds]);
    await client.query(`DELETE FROM lecturer_modules WHERE lecturer_id = ANY($1::int[])`, [lecIds]);
    await client.query(
      `UPDATE applications SET assigned_lecturer_id = NULL WHERE assigned_lecturer_id = ANY($1::int[])`,
      [lecIds]
    );
  }

  await client.query(
    `UPDATE applications SET assigned_lecturer_id = NULL WHERE assigned_lecturer_id = ANY($1::int[])`,
    [ids]
  );
  await client.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [ids]);
  console.log(`Removed demo users: ${rows.map((r) => r.email).join(', ')}`);
}

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await removeDemoUsers(client);

    const adminHash = await bcrypt.hash(adminPassword, COST);
    await client.query(
      `
      INSERT INTO users (first_names, surname, email, password_hash, role, temp_password_flag)
      VALUES ($1, $2, $3, $4, 'admin', FALSE)
      ON CONFLICT (email) DO UPDATE SET
        first_names = EXCLUDED.first_names,
        surname = EXCLUDED.surname,
        password_hash = EXCLUDED.password_hash,
        role = 'admin',
        temp_password_flag = FALSE
      `,
      [ADMIN.first_names, ADMIN.surname, ADMIN.email, adminHash]
    );

    await client.query('COMMIT');
    console.log(`✓ Admin ready: ${ADMIN.email}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('✗ Seed failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
