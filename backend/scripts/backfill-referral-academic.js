'use strict';

require('dotenv').config();
const pool = require('../db');
const { findCurriculumModule } = require('../constants');

const ICT_FACULTY = 'Information & Communication Technology';

(async () => {
  const result = await pool.query(
    `SELECT id, course, module_code, module_name, faculty, module_year_level
     FROM applications
     WHERE status = 'approved'
       AND (
         faculty IS NULL OR TRIM(faculty) = ''
         OR module_year_level IS NULL OR TRIM(module_year_level) = ''
       )`
  );

  let updated = 0;
  for (const row of result.rows) {
    const hit = findCurriculumModule(
      row.course,
      null,
      row.module_name,
      row.module_code
    );
    const faculty = row.faculty && String(row.faculty).trim()
      ? row.faculty
      : ICT_FACULTY;
    const moduleYearLevel =
      row.module_year_level && String(row.module_year_level).trim()
        ? row.module_year_level
        : hit?.yearKey || null;

    if (
      faculty === row.faculty &&
      moduleYearLevel === row.module_year_level
    ) {
      continue;
    }

    await pool.query(
      `UPDATE applications
       SET faculty = $1,
           module_year_level = COALESCE($2, module_year_level),
           updated_at = NOW()
       WHERE id = $3`,
      [faculty, moduleYearLevel, row.id]
    );
    updated += 1;
    console.log(
      `app ${row.id}: faculty=${faculty}, year=${moduleYearLevel || '-'}`
    );
  }

  console.log(`Backfilled ${updated} application(s).`);
  await pool.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
