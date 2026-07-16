'use strict';

/**
 * Smoke-check VeriFlow schema + seed against DATABASE_URL (Supabase).
 * Usage (backend/): node scripts/check-supabase.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcrypt');
const pool = require('../db');

const REQUIRED_TABLES = [
  'users',
  'applications',
  'modules',
  'lecturer_modules',
  'tutor_profiles',
  'sessions',
  'session_tutors',
  'claims',
  'claim_sessions',
  'referrals',
  'postings',
  'students',
  'settings',
  'class_list_entries',
  'message_threads',
  'messages',
  'coordinator_threads',
  'coordinator_messages',
  'support_tickets',
  'support_ticket_replies',
  'system_settings',
  'attendance_logs',
  'session_qr_tokens',
  'attendance_passes',
];

const DEMO_EMAILS = [
  'fye@ump.ac.za',
  'smahlangu@ump.ac.za',
  'cnkosi@ump.ac.za',
  'tdlamini@ump.ac.za',
  'bmasondo@ump.ac.za',
];

async function main() {
  const report = { ok: [], warn: [], fail: [] };
  const pass = (msg) => report.ok.push(msg);
  const warn = (msg) => report.warn.push(msg);
  const fail = (msg) => report.fail.push(msg);

  // Connection / host
  let host = '';
  try {
    host = new URL(process.env.DATABASE_URL).hostname;
  } catch {
    fail('DATABASE_URL is invalid');
  }
  if (host.includes('supabase') || host.includes('pooler.supabase')) {
    pass(`Connected host: ${host}`);
  } else if (host === 'localhost' || host === '127.0.0.1') {
    fail(`Still on local Postgres (${host}) — not Supabase`);
  } else {
    warn(`Host is ${host} (expected Supabase)`);
  }

  const dbInfo = await pool.query(
    'SELECT current_database() AS db, current_user AS usr, version() AS version'
  );
  pass(`Database=${dbInfo.rows[0].db} user=${dbInfo.rows[0].usr}`);
  pass(`Postgres: ${String(dbInfo.rows[0].version).split(',')[0]}`);

  // Required tables
  const tables = await pool.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`
  );
  const have = new Set(tables.rows.map((r) => r.table_name));
  const missing = REQUIRED_TABLES.filter((t) => !have.has(t));
  if (missing.length) {
    fail(`Missing tables: ${missing.join(', ')}`);
  } else {
    pass(`All ${REQUIRED_TABLES.length} required tables present`);
  }
  pass(`Public tables total: ${tables.rows.length}`);

  // Critical enums
  const enums = await pool.query(
    `SELECT t.typname
     FROM pg_type t
     JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public' AND t.typtype = 'e'
     ORDER BY 1`
  );
  const enumNames = enums.rows.map((r) => r.typname);
  for (const name of ['user_role', 'application_status', 'programme_type', 'session_status']) {
    if (enumNames.includes(name)) pass(`Enum ${name} exists`);
    else fail(`Enum ${name} missing`);
  }

  // Modules curriculum
  const modCount = await pool.query('SELECT COUNT(*)::int AS n FROM modules');
  const byCourse = await pool.query(
    `SELECT course::text AS course, COUNT(*)::int AS n
     FROM modules GROUP BY course ORDER BY course`
  );
  if (modCount.rows[0].n >= 40) {
    pass(`Modules seeded: ${modCount.rows[0].n} (${byCourse.rows.map((r) => `${r.course}=${r.n}`).join(', ')})`);
  } else if (modCount.rows[0].n === 0) {
    fail('modules table is empty — run npm run db:modules');
  } else {
    warn(`modules count only ${modCount.rows[0].n} (expected ~49)`);
  }

  // Sample codes used by apply flow
  for (const code of ['DICT211', 'DICT111', 'PRJ300', 'PRT101']) {
    const r = await pool.query('SELECT 1 FROM modules WHERE code = $1', [code]);
    if (r.rows.length) pass(`Module ${code} present`);
    else fail(`Module ${code} missing`);
  }

  // Admin account
  const admin = await pool.query(
    `SELECT id, email, role, temp_password_flag, password_hash
     FROM users WHERE LOWER(email) = LOWER($1)`,
    ['veriflow@ump.ac.za']
  );
  if (!admin.rows[0]) {
    fail('Admin veriflow@ump.ac.za not found — run node seed.js');
  } else {
    const a = admin.rows[0];
    if (a.role !== 'admin') fail(`veriflow@ump.ac.za role is ${a.role}, expected admin`);
    else pass(`Admin user present (id=${a.id}, role=admin)`);
    const okPw = await bcrypt.compare('Admin@VeriFlow2026', a.password_hash);
    if (okPw) pass('Admin password hash matches Admin@VeriFlow2026');
    else fail('Admin password hash does NOT match expected password');
    if (a.temp_password_flag) warn('Admin has temp_password_flag=true');
  }

  // Demo accounts should be gone
  const demos = await pool.query(
    `SELECT email FROM users WHERE email = ANY($1::text[])`,
    [DEMO_EMAILS]
  );
  if (demos.rows.length) {
    warn(`Legacy demo users still present: ${demos.rows.map((r) => r.email).join(', ')}`);
  } else {
    pass('Legacy demo users removed');
  }

  // System settings row (often expected)
  if (have.has('system_settings')) {
    const settings = await pool.query('SELECT COUNT(*)::int AS n FROM system_settings');
    if (settings.rows[0].n > 0) pass(`system_settings rows: ${settings.rows[0].n}`);
    else warn('system_settings is empty (admin settings page may use defaults)');
  }

  // User / application counts
  const counts = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM users) AS users,
      (SELECT COUNT(*)::int FROM applications) AS applications,
      (SELECT COUNT(*)::int FROM sessions) AS sessions,
      (SELECT COUNT(*)::int FROM postings) AS postings,
      (SELECT COUNT(*)::int FROM students) AS students
  `);
  const c = counts.rows[0];
  pass(`Counts — users=${c.users} applications=${c.applications} sessions=${c.sessions} postings=${c.postings} students=${c.students}`);

  // Apply registry check simulation
  const registry = await pool.query(
    `SELECT code FROM modules WHERE code = $1`,
    ['DICT211']
  );
  if (registry.rows.length) pass('Apply registry check would pass for DICT211');
  else fail('Apply registry check would fail for DICT211');

  console.log('\n=== Supabase VeriFlow audit ===\n');
  for (const msg of report.ok) console.log(`OK   ${msg}`);
  for (const msg of report.warn) console.log(`WARN ${msg}`);
  for (const msg of report.fail) console.log(`FAIL ${msg}`);
  console.log(
    `\nSummary: ${report.ok.length} ok, ${report.warn.length} warn, ${report.fail.length} fail`
  );
  if (report.fail.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('Audit crashed:', e.message);
    if (e.stack) console.error(e.stack.split('\n').slice(0, 6).join('\n'));
    process.exitCode = 1;
  })
  .finally(() => pool.end());
