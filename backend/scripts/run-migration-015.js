require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const sql = fs.readFileSync(
    require('path').join(__dirname, '..', 'migrations', '015_messages.sql'),
    'utf8'
  );
  await pool.query(sql);
  console.log('Migration 015 applied: message_threads, messages');
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
