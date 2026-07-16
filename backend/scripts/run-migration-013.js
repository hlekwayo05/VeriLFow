require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const pool = require('../db');

async function main() {
  const sql = fs.readFileSync(
    require('path').join(__dirname, '..', 'migrations', '013_tutor_onboarding_persist.sql'),
    'utf8'
  );
  await pool.query(sql);
  const r = await pool.query(`
    SELECT u.email, a.status, tp.step1_complete, tp.step2_complete
    FROM users u
    JOIN applications a ON a.user_id = u.id
    LEFT JOIN tutor_profiles tp ON tp.user_id = u.id
    WHERE u.email IN ('masana@ump.ac.za', 'waka@ump.ac.za')
  `);
  console.log('masana/waka after migration:');
  console.table(r.rows);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
