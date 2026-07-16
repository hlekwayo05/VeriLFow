require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db');

async function main() {
  const today = new Date();
  const local = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const rows = await pool.query(
    `SELECT id, module_code, session_date, start_time, status
     FROM sessions ORDER BY session_date DESC LIMIT 15`
  );
  console.log('Local today:', local);
  console.log('Sessions:');
  for (const r of rows.rows) {
    const raw = r.session_date;
    console.log(`  id=${r.id} module=${r.module_code} date=${raw} typeof=${typeof raw} json=${JSON.stringify(raw)} status=${r.status}`);
  }
  await pool.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
