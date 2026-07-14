require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '016_end_time_and_qr_tables.sql'),
    'utf8'
  );
  await pool.query(sql);
  console.log('Migration 016 applied: sessions.end_time + QR/class-list tables');
  await pool.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
