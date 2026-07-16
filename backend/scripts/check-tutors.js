require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcrypt');
const pool = require('../db');

async function main() {
  const tutors = await pool.query(`
    SELECT u.id, u.email, a.status, a.id AS app_id,
           tp.step1_complete, tp.step2_complete
    FROM users u
    LEFT JOIN applications a ON a.user_id = u.id
    LEFT JOIN tutor_profiles tp ON tp.user_id = u.id
    WHERE u.role = 'tutor'
    ORDER BY u.email
  `);
  console.log('=== Tutors in DB ===');
  console.table(tutors.rows);

  // Test login API logic for first few tutors
  for (const t of tutors.rows.slice(0, 5)) {
    const appResult = await pool.query(
      `SELECT status FROM applications WHERE user_id = $1`,
      [t.id]
    );
    const onboardResult = await pool.query(
      `SELECT step1_complete, step2_complete FROM tutor_profiles WHERE user_id = $1`,
      [t.id]
    );
    let applicationStatus = null;
    let onboardingComplete = false;
    if (appResult.rows.length > 0) applicationStatus = appResult.rows[0].status;
    if (onboardResult.rows.length > 0) {
      const o = onboardResult.rows[0];
      onboardingComplete = o.step1_complete && o.step2_complete;
    }
    console.log(`${t.email}: status=${applicationStatus}, onboard=${onboardingComplete}`);
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
