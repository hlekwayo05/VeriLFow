require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const API = 'http://127.0.0.1:3000/api';

async function main() {
  const r = await pool.query(`
    SELECT u.id, u.email, a.status, a.module_code, a.module_name,
           tp.step1_complete, tp.step2_complete
    FROM users u
    JOIN applications a ON a.user_id = u.id
    LEFT JOIN tutor_profiles tp ON tp.user_id = u.id
    WHERE u.email ILIKE '%masana%'
  `);
  console.table(r.rows);

  const userId = r.rows[0]?.id;
  if (!userId) return;

  const token = jwt.sign(
    { userId, role: 'tutor', applicationStatus: 'approved', onboardingComplete: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  const h = { Authorization: `Bearer ${token}` };

  for (const path of ['/applications/me', '/users/me', '/users/me/modules', '/sessions?moduleCode=DICT111']) {
    const res = await fetch(`${API}${path}`, { headers: h });
    const body = await res.text();
    console.log(path, res.status, body.slice(0, 200));
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
