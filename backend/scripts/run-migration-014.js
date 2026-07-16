require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const pool = require('../db');

async function main() {
  const sql = fs.readFileSync(
    require('path').join(__dirname, '..', 'migrations', '014_class_list_email.sql'),
    'utf8'
  );
  await pool.query(sql);
  console.log('Migration 014 applied: class_list_entries.email');
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
