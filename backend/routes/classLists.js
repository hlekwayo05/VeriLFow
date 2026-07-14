'use strict';

const router       = require('express').Router();
const pool         = require('../db');
const authenticate = require('../middleware/authenticate');
const requireRole  = require('../middleware/requireRole');

async function lecturerOwnsModule(lecturerId, moduleCode) {
  const result = await pool.query(
    `SELECT module_code FROM lecturer_modules
     WHERE lecturer_id = $1 AND module_code = $2
     LIMIT 1`,
    [lecturerId, moduleCode]
  );
  return result.rows.length > 0;
}

function normalizeEntry(row) {
  const studentNumber = String(
    row.student_number || row.studentNumber || row['Student No.'] || row['student no'] || ''
  ).trim();

  const firstName = String(
    row.first_names || row.firstNames || row.first_name || row.firstName || row.first || ''
  ).trim();
  const surname = String(
    row.surname || row.last_name || row.lastName || row.last || ''
  ).trim();
  const combinedName = `${firstName} ${surname}`.trim();

  const fullName = String(
    row.full_name || row.fullName || row.name || row['Full Name'] || row['full name'] || combinedName || ''
  ).trim();

  const yearLevel = String(
    row.year_level || row.yearLevel || row.year || row.Year || ''
  ).trim() || null;

  const email = String(row.email || row.Email || '').trim() || null;

  return { studentNumber, fullName, yearLevel, email };
}

// GET /api/class-lists?moduleCode=DICT111
router.get(
  '/',
  authenticate,
  requireRole('lecturer'),
  async (req, res) => {
    const moduleCode = req.query.moduleCode
      ? String(req.query.moduleCode).trim().toUpperCase()
      : null;

    if (!moduleCode) {
      return res.status(400).json({ errors: ['moduleCode is required.'] });
    }

    try {
      const owns = await lecturerOwnsModule(req.user.userId, moduleCode);
      if (!owns) {
        return res.status(403).json({ errors: ['You are not assigned to this module.'] });
      }

      const result = await pool.query(
        `SELECT id, module_code, student_number, full_name, email, year_level, status, updated_at
         FROM class_list_entries
         WHERE module_code = $1
         ORDER BY full_name ASC`,
        [moduleCode]
      );

      const meta = await pool.query(
        `SELECT module_name, course FROM lecturer_modules
         WHERE lecturer_id = $1 AND module_code = $2
         LIMIT 1`,
        [req.user.userId, moduleCode]
      );

      const lastUpdated = result.rows.reduce((latest, row) => {
        const ts = row.updated_at ? new Date(row.updated_at).getTime() : 0;
        return ts > latest ? ts : latest;
      }, 0);

      return res.status(200).json({
        moduleCode,
        moduleName: meta.rows[0]?.module_name || moduleCode,
        course:     meta.rows[0]?.course || '',
        count:      result.rows.length,
        lastUpdated: lastUpdated ? new Date(lastUpdated).toISOString() : null,
        entries:    result.rows,
      });

    } catch (err) {
      console.error('Get class list error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);

// POST /api/class-lists/import
router.post(
  '/import',
  authenticate,
  requireRole('lecturer'),
  async (req, res) => {
    const moduleCode = req.body.moduleCode
      ? String(req.body.moduleCode).trim().toUpperCase()
      : null;
    const entries = req.body.entries || req.body.students || [];

    if (!moduleCode) {
      return res.status(400).json({ errors: ['moduleCode is required.'] });
    }
    if (!Array.isArray(entries) || !entries.length) {
      return res.status(400).json({ errors: ['Provide at least one class list entry.'] });
    }

    try {
      const owns = await lecturerOwnsModule(req.user.userId, moduleCode);
      if (!owns) {
        return res.status(403).json({ errors: ['You are not assigned to this module.'] });
      }

      const client = await pool.connect();
      let imported = 0;
      let skipped  = 0;

      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM class_list_entries WHERE module_code = $1', [moduleCode]);

        for (const row of entries) {
          const { studentNumber, fullName, yearLevel, email } = normalizeEntry(row);
          if (!studentNumber || !fullName) {
            skipped += 1;
            continue;
          }

          await client.query(
            `INSERT INTO class_list_entries
               (module_code, student_number, full_name, email, year_level, status)
             VALUES ($1, $2, $3, $4, $5, 'Active')
             ON CONFLICT (module_code, student_number)
             DO UPDATE SET
               full_name  = EXCLUDED.full_name,
               email      = EXCLUDED.email,
               year_level = EXCLUDED.year_level,
               status     = 'Active',
               updated_at = NOW()`,
            [moduleCode, studentNumber, fullName, email, yearLevel]
          );
          imported += 1;
        }

        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      return res.status(200).json({ imported, skipped, moduleCode });

    } catch (err) {
      console.error('Import class list error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);

module.exports = router;
