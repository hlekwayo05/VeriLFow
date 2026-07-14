require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const u = await pool.query(`SELECT id FROM users WHERE email = 'masana@ump.ac.za'`);
  const userId = u.rows[0].id;

  const sessions = await pool.query(`
    SELECT s.id, s.module_code, s.topic, s.status, s.session_date, s.start_time,
           st.tutor_id, st.confirmed_at, st.declined_at
    FROM sessions s
    LEFT JOIN session_tutors st ON st.session_id = s.id AND st.tutor_id = $1
    WHERE s.module_code = 'DICT111'
    ORDER BY s.session_date DESC
  `, [userId]);
  console.log('Masana sessions:');
  console.table(sessions.rows);

  const token = jwt.sign({ userId, role: 'tutor', applicationStatus: 'approved', onboardingComplete: true }, process.env.JWT_SECRET, { expiresIn: '1h' });

  for (const s of sessions.rows) {
    const r = await fetch(`http://127.0.0.1:3000/api/sessions/${s.id}/qr`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await r.json();
    console.log(`QR session ${s.id} status=${s.status}:`, r.status, body.errors?.[0] || 'OK');
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
