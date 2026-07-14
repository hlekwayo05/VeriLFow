/**
 * VeriFlow — Node.js seed runner
 * Generates real bcrypt hashes then inserts all seed data.
 *
 * Usage:
 *   npm install  (installs bcrypt and pg from package.json)
 *   node seed.js
 *
 * Requires .env with DATABASE_URL set.
 */

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt   = require('bcrypt');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const COST = 12;

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Hashes ──────────────────────────────────────────────
    const adminHash    = await bcrypt.hash('Admin@VeriFlow2026', COST);
    const lecturerHash = await bcrypt.hash('Temp1234',           COST);
    const tutorHash    = await bcrypt.hash('Tutor1234',          COST);

    // ── Admin ────────────────────────────────────────────────
    await client.query(`
      INSERT INTO users (first_names, surname, email, password_hash, role)
      VALUES ($1, $2, $3, $4, 'admin')
      ON CONFLICT (email) DO NOTHING
    `, ['FYE', 'Coordinator', 'fye@ump.ac.za', adminHash]);

    // ── Lecturer ─────────────────────────────────────────────
    await client.query(`
      INSERT INTO users
        (first_names, surname, email, cell, password_hash, role, temp_password_flag)
      VALUES ($1, $2, $3, $4, $5, 'lecturer', TRUE)
      ON CONFLICT (email) DO NOTHING
    `, ['Dr Sipho', 'Mahlangu', 'smahlangu@ump.ac.za', '0137723001', lecturerHash]);

    const lecRes = await client.query(
      `SELECT id FROM users WHERE email = $1`, ['smahlangu@ump.ac.za']
    );
    const lecId = lecRes.rows[0].id;

    await client.query(`
      INSERT INTO lecturer_modules (lecturer_id, course, module_code, module_name)
      VALUES
        ($1, 'DICT — Diploma in ICT', 'IS211',  'Information Systems'),
        ($1, 'DICT — Diploma in ICT', 'APD301', 'Application Development'),
        ($1, 'DICT — Diploma in ICT', 'PRJ300', 'Project 300')
      ON CONFLICT (course, module_name) DO NOTHING
    `, [lecId]);

    // ── Tutors ───────────────────────────────────────────────
    const tutors = [
      { student_number: '220012345', title: 'Ms',  initials: 'C N',
        first_names: 'Carol',  surname: 'Nkosi',   email: 'cnkosi@ump.ac.za',
        cell: '0821234567', qual: '4th_year_honours',
        year_level: '2nd Year — Semester 1', module: 'Information Systems',
        gpa: 82.5, status: 'approved' },
      { student_number: '210098765', title: 'Mr',  initials: 'T D',
        first_names: 'Thabo',  surname: 'Dlamini', email: 'tdlamini@ump.ac.za',
        cell: '0837654321', qual: '3rd_year',
        year_level: '2nd Year — Semester 1', module: 'Application Development',
        gpa: 78.0, status: 'approved' },
      { student_number: '220055512', title: 'Ms',  initials: 'B M',
        first_names: 'Bongi',  surname: 'Masondo', email: 'bmasondo@ump.ac.za',
        cell: '0849876543', qual: '3rd_year',
        year_level: '3rd Year — Semester 1 & 2', module: 'Information Systems',
        gpa: 76.0, status: 'shortlisted' },
    ];

    for (const t of tutors) {
      await client.query(`
        INSERT INTO users
          (student_number, title, initials, first_names, surname,
           email, cell, password_hash, role)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'tutor')
        ON CONFLICT (email) DO NOTHING
      `, [t.student_number, t.title, t.initials, t.first_names,
          t.surname, t.email, t.cell, tutorHash]);

      const uRes = await client.query(
        `SELECT id FROM users WHERE email = $1`, [t.email]
      );
      const uid = uRes.rows[0].id;

      await client.query(`
        INSERT INTO applications
          (user_id, faculty, course, qualification_level,
           module_year_level, module_name, gpa,
           cv_filename, transcript_filename, declared, status, submitted_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,$10,NOW())
        ON CONFLICT (user_id) DO NOTHING
      `, [uid,
          'Information & Communication Technology',
          'DICT — Diploma in ICT',
          t.qual,
          t.year_level,
          t.module,
          t.gpa,
          `cv_${t.surname.toLowerCase()}.pdf`,
          `transcript_${t.surname.toLowerCase()}.pdf`,
          t.status]);

      if (t.status === 'approved') {
        // Auto-assign the lecturer who owns this course+module, same
        // matching rule used by PATCH /api/applications/:id/approve.
        await client.query(`
          UPDATE applications
          SET assigned_lecturer_id = (
            SELECT lecturer_id FROM lecturer_modules
            WHERE course = 'DICT — Diploma in ICT' AND module_name = $2
            LIMIT 1
          )
          WHERE user_id = $1
        `, [uid, t.module]);

        await client.query(`
          INSERT INTO tutor_profiles (user_id, step1_complete, step2_complete)
          VALUES ($1, TRUE, TRUE)
          ON CONFLICT (user_id) DO NOTHING
        `, [uid]);
      }
    }

    // ── Sessions ─────────────────────────────────────────────
    const sessionData = [
      ['IS211', 'Database Normalisation & ER Diagrams', 'practical', '2026-01-28', '10:00', 'Lab 2B',  'completed'],
      ['IS211', 'SQL Queries & Joins',                  'online',    '2026-01-30', '14:00', 'Online',  'completed'],
      ['IS211', 'Systems Analysis & Design',            'practical', '2026-02-03', '10:00', 'Lab 4B',  'scheduled'],
      ['APD301','Application Architecture Intro',       'lecture',   '2026-02-05', '09:00', 'Hall A',  'scheduled'],
    ];

    for (const [code, topic, type, date, time, venue, status] of sessionData) {
      await client.query(`
        INSERT INTO sessions
          (lecturer_id, module_code, topic, session_type,
           session_date, start_time, venue, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `, [lecId, code, topic, type, date, time, venue, status]);
    }

    await client.query('COMMIT');
    console.log('✓ Seed complete');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('✗ Seed failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();