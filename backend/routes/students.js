'use strict';

const router       = require('express').Router();
const pool         = require('../db');
const authenticate = require('../middleware/authenticate');
const requireRole  = require('../middleware/requireRole');
const { studentImportLimiter } = require('../middleware/rateLimiter');
const { validateCreateStudent, validateImportStudents } = require('../validators/studentValidator');

function normalizeProgramme(value) {
  if (!value) return null;
  const upper = String(value).trim().toUpperCase();
  return upper === 'BICT' || upper === 'DICT' ? upper : null;
}


router.get(
  '/',
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, first_names, surname, email, student_number, programme, year_level, created_at
         FROM students
         ORDER BY surname ASC, first_names ASC`
      );
      return res.status(200).json(result.rows);
    } catch (err) {
      console.error('Get students error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);


router.post(
  '/',
  authenticate,
  requireRole('admin'),
  validateCreateStudent,
  async (req, res) => {
    const {
      first_names,
      firstNames,
      surname,
      email,
      student_number,
      studentNumber,
      programme,
      year_level,
      yearLevel,
    } = req.body;

    const firstNameValue = (first_names || firstNames || '').trim();
    const surnameValue   = (surname || '').trim();
    const emailValue     = (email || '').trim().toLowerCase();
    const studentNo      = (student_number || studentNumber || '').trim() || null;
    const programmeValue = normalizeProgramme(programme);
    const yearLevelValue = (year_level || yearLevel || '').trim() || null;

    try {
      const result = await pool.query(
        `INSERT INTO students
           (first_names, surname, email, student_number, programme, year_level)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [firstNameValue, surnameValue, emailValue, studentNo, programmeValue, yearLevelValue]
      );
      return res.status(201).json(result.rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ errors: ['A student with that email or student number already exists.'] });
      }
      console.error('Create student error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);


router.post(
  '/import',
  studentImportLimiter,
  authenticate,
  requireRole('admin'),
  validateImportStudents,
  async (req, res) => {
    const students = req.body.students || req.body;

    let imported = 0;
    let skipped  = 0;

    for (const row of students) {
      const firstNameValue = (row.first_names || row.firstNames || '').trim();
      const surnameValue   = (row.surname || '').trim();
      const emailValue     = (row.email || '').trim().toLowerCase();
      const studentNo      = (row.student_number || row.studentNumber || '').trim() || null;
      const programmeValue = normalizeProgramme(row.programme);
      const yearLevelValue = (row.year_level || row.yearLevel || '').trim() || null;

      if (!firstNameValue || !surnameValue || !emailValue) {
        skipped += 1;
        continue;
      }

      try {
        const result = await pool.query(
          `INSERT INTO students
             (first_names, surname, email, student_number, programme, year_level)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (email) DO NOTHING
           RETURNING id`,
          [firstNameValue, surnameValue, emailValue, studentNo, programmeValue, yearLevelValue]
        );
        if (result.rows.length) imported += 1;
        else skipped += 1;
      } catch (err) {
        if (err.code === '23505') {
          skipped += 1;
        } else {
          console.error('Import student error:', err.message);
          skipped += 1;
        }
      }
    }

    return res.status(200).json({ imported, skipped, total: students.length });
  }
);


router.delete(
  '/:id',
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    const studentId = parseInt(req.params.id, 10);

    try {
      const result = await pool.query(
        'DELETE FROM students WHERE id = $1 RETURNING id',
        [studentId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ errors: ['Student not found.'] });
      }

      return res.status(200).json({ message: 'Student removed.' });
    } catch (err) {
      console.error('Delete student error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);


module.exports = router;
