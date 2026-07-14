require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const API = 'http://127.0.0.1:3000/api';

async function login(email) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Tutor1234' }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`${email}: ${d.errors?.[0] || 'login failed'}`);
  return d.token;
}

async function get(token, path) {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, data: d };
}

async function main() {
  const emails = ['masana@ump.ac.za', 'waka@ump.ac.za', 'cnkosi@ump.ac.za'];

  for (const email of emails) {
    console.log('\n===', email, '===');
    try {
      const token = await login(email);
      const app = await get(token, '/applications/me');
      const mods = await get(token, '/users/me/modules');
      const sessions = await get(token, '/sessions');
      console.log('applications/me', app.status, app.data.status, app.data.module_name, app.data.module_code, app.data.course);
      console.log('users/me/modules', mods.status, JSON.stringify(mods.data));
      console.log('sessions', sessions.status, Array.isArray(sessions.data) ? sessions.data.length + ' sessions' : sessions.data);
    } catch (e) {
      console.log('ERROR', e.message);
      const u = await pool.query(`
        SELECT u.email, a.status, a.module_name, a.module_code, a.course, a.assigned_lecturer_id,
               tp.step1_complete, tp.step2_complete
        FROM users u
        JOIN applications a ON a.user_id = u.id
        LEFT JOIN tutor_profiles tp ON tp.user_id = u.id
        WHERE u.email = $1`, [email]);
      console.table(u.rows);
    }
  }

  const lm = await pool.query(`SELECT course, module_code, module_name FROM lecturer_modules ORDER BY module_code`);
  console.log('\n=== lecturer_modules ===');
  console.table(lm.rows);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
