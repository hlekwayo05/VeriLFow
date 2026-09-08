'use strict';

require('dotenv').config();
const pool = require('../db');
const { studentNumberFromUmpEmail } = require('../utils/studentNumber');

(async () => {
  const result = await pool.query(
    `SELECT id, email, student_number
     FROM users
     WHERE role = 'tutor'
       AND (student_number IS NULL OR TRIM(student_number) = '')`
  );

  let updated = 0;
  for (const user of result.rows) {
    const studentNumber = studentNumberFromUmpEmail(user.email);
    if (!studentNumber) continue;
    await pool.query(
      `UPDATE users
       SET student_number = $1, updated_at = NOW()
       WHERE id = $2`,
      [studentNumber, user.id]
    );
    updated += 1;
    console.log(`${user.email} -> ${studentNumber}`);
  }

  console.log(`Backfilled ${updated} tutor(s).`);
  await pool.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
