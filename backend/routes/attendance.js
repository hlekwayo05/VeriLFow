'use strict';

/*
 * ATTENDANCE SCAN FLOW
 * ====================
 * Step 1: Student scans QR code containing a rotating token (?t=)
 * Step 2: attendance-scan.html calls POST /attendance/enter
 *         with the token → backend validates token and returns
 *         a passToken (longer-lived, stored in attendance_passes)
 * Step 3: Student submits their student number
 * Step 4: attendance-scan.html calls POST /attendance
 *         with { passToken, studentNumber }
 *         → backend records sign-in in attendance_logs
 *
 * Legacy path: POST /attendance also accepts
 *   { sessionCode, studentNumber } for backward compatibility.
 */

const router = require('express').Router();
const pool   = require('../db');
const authenticate = require('../middleware/authenticate');
const requireRole  = require('../middleware/requireRole');
const {
  findSessionByQrToken,
  createAttendancePass,
  findValidPass,
  sessionPublicView,
} = require('../services/qrTokens');

function isValidStudentNumber(value) {
  return /^[A-Za-z0-9]{6,15}$/.test(String(value || '').trim());
}

function formatSessionType(type) {
  const map = {
    tutorial: 'Tutorial', practical: 'Practical', online: 'Online',
    revision: 'Revision', lecture: 'Lecture',
  };
  return map[type] || type;
}


router.post('/enter', async (req, res) => {
  const qrToken = String(req.body.qrToken || req.body.token || '').trim();

  if (!qrToken || typeof qrToken !== 'string') {
    return res.status(400).json({ errors: ['QR token is required.'] });
  }

  try {
    const session = await findSessionByQrToken(qrToken);

    if (!session) {
      return res.status(404).json({
        errors: ['This QR code has expired. Please scan the latest code shown by your tutor.'],
      });
    }

    if (session.status !== 'active') {
      return res.status(409).json({ errors: ['This session is not currently active.'] });
    }

    const pass = await createAttendancePass(session);

    return res.status(200).json({
      passToken: pass.token,
      passExpiresAt: pass.expires_at,
      session: sessionPublicView(session),
    });

  } catch (err) {
    console.error('Attendance enter error:', err.message);
    return res.status(500).json({ errors: ['Server error. Please try again.'] });
  }
});


router.get('/pass/:passToken', async (req, res) => {
  const passToken = String(req.params.passToken || '').trim();

  try {
    const pass = await findValidPass(passToken);
    if (!pass) {
      return res.status(404).json({ errors: ['Your attendance link has expired. Please scan the QR code again.'] });
    }

    if (pass.status !== 'active') {
      return res.status(409).json({ errors: ['This session is no longer active.'] });
    }

    const existing = await pool.query(
      `SELECT student_number, recorded_at
       FROM attendance_logs
       WHERE session_id = $1
       ORDER BY recorded_at DESC
       LIMIT 1`,
      [pass.session_id]
    );

    return res.status(200).json({
      passToken,
      session: sessionPublicView(pass),
      alreadyRecorded: existing.rows[0] || null,
    });

  } catch (err) {
    console.error('Attendance pass error:', err.message);
    return res.status(500).json({ errors: ['Server error.'] });
  }
});


router.post('/', async (req, res) => {
  const passToken     = String(req.body.passToken || '').trim();
  const studentNumber = String(req.body.studentNumber || '').trim();
  const sessionCode   = String(req.body.sessionCode || '').trim().toUpperCase();

  if (passToken) {
    if (!studentNumber) {
      return res.status(400).json({ errors: ['Student number is required.'] });
    }
    if (!isValidStudentNumber(studentNumber)) {
      return res.status(400).json({
        errors: ['Student number must be 6-15 alphanumeric characters.'],
      });
    }

    try {
      const pass = await findValidPass(passToken);
      if (!pass) {
        return res.status(404).json({
          errors: ['Your attendance link has expired. Please scan the QR code again.'],
        });
      }

      if (pass.status !== 'active') {
        return res.status(409).json({ errors: ['This session is not currently active.'] });
      }

      const classRow = await pool.query(
        `SELECT full_name, year_level, status, student_number
         FROM class_list_entries
         WHERE module_code = $1
           AND TRIM(student_number) = $2
         LIMIT 1`,
        [pass.module_code, studentNumber]
      );

      if (!classRow.rows.length) {
        return res.status(403).json({
          errors: [`Student number "${studentNumber}" is not registered for ${pass.module_code}. Please check your number or contact your lecturer.`],
        });
      }

      const matchedNumber = classRow.rows[0].student_number;

      const duplicate = await pool.query(
        `SELECT id FROM attendance_logs
         WHERE session_id = $1 AND student_number = $2`,
        [pass.session_id, matchedNumber]
      );

      if (duplicate.rows.length > 0) {
        return res.status(409).json({
          errors: ['Your attendance has already been recorded for this session.'],
        });
      }

      const insert = await pool.query(
        `INSERT INTO attendance_logs (session_id, student_number)
         VALUES ($1, $2)
         RETURNING recorded_at`,
        [pass.session_id, matchedNumber]
      );

      const student = classRow.rows[0];

      return res.status(201).json({
        message:       'Attendance recorded successfully.',
        studentNumber: matchedNumber,
        fullName:      student.full_name,
        module:        pass.module_code,
        sessionDate:   pass.session_date,
        sessionType:   pass.session_type,
        sessionTypeLabel: formatSessionType(pass.session_type),
        topic:         pass.topic,
        venue:         pass.venue,
        recordedAt:    insert.rows[0].recorded_at,
      });

    } catch (err) {
      console.error('Attendance error:', err.message);
      return res.status(500).json({ errors: ['Server error. Please try again.'] });
    }
  }

  // Legacy: session code flow (lecturer-activated static code)
  const errors = [];
  if (!studentNumber) errors.push('Student number is required.');
  if (!sessionCode)   errors.push('Session code is required.');
  if (studentNumber && !isValidStudentNumber(studentNumber)) {
    errors.push('Student number must be 6-15 alphanumeric characters.');
  }
  if (errors.length) return res.status(400).json({ errors });

  try {
    const sessionResult = await pool.query(
      `SELECT id, status, code_expires_at, module_code, session_type, session_date, topic, venue
       FROM sessions WHERE session_code = $1`,
      [sessionCode]
    );

    if (!sessionResult.rows.length) {
      return res.status(404).json({ errors: ['Invalid session code.'] });
    }

    const session = sessionResult.rows[0];

    if (session.status !== 'active') {
      return res.status(409).json({ errors: ['This session is not currently active.'] });
    }

    if (session.code_expires_at && new Date() > new Date(session.code_expires_at)) {
      return res.status(409).json({ errors: ['This session code has expired.'] });
    }

    const classRow = await pool.query(
      `SELECT full_name, student_number FROM class_list_entries
       WHERE module_code = $1 AND TRIM(student_number) = $2 LIMIT 1`,
      [session.module_code, studentNumber]
    );

    if (!classRow.rows.length) {
      return res.status(403).json({
        errors: [`Student number "${studentNumber}" is not registered for ${session.module_code}.`],
      });
    }

    const matchedNumber = classRow.rows[0].student_number;

    const duplicate = await pool.query(
      `SELECT id FROM attendance_logs WHERE session_id = $1 AND student_number = $2`,
      [session.id, matchedNumber]
    );

    if (duplicate.rows.length) {
      return res.status(409).json({ errors: ['Your attendance has already been recorded for this session.'] });
    }

    const insert = await pool.query(
      `INSERT INTO attendance_logs (session_id, student_number) VALUES ($1, $2) RETURNING recorded_at`,
      [session.id, matchedNumber]
    );

    return res.status(201).json({
      message: 'Attendance recorded successfully.',
      studentNumber: matchedNumber,
      fullName: classRow.rows[0].full_name,
      module: session.module_code,
      sessionDate: session.session_date,
      sessionType: session.session_type,
      recordedAt: insert.rows[0].recorded_at,
    });

  } catch (err) {
    console.error('Attendance error:', err.message);
    return res.status(500).json({ errors: ['Server error. Please try again.'] });
  }
});


router.get(
  '/:sessionId',
  authenticate,
  requireRole('admin', 'lecturer', 'tutor'),
  async (req, res) => {
    const sessionId = parseInt(req.params.sessionId);
    const { userId, role } = req.user;

    if (!sessionId) {
      return res.status(404).json({ errors: ['Session not found'] });
    }

    try {
      const sessionCheck = await pool.query(
        'SELECT id, lecturer_id FROM sessions WHERE id = $1',
        [sessionId]
      );
      if (!sessionCheck.rows.length) {
        return res.status(404).json({ errors: ['Session not found'] });
      }

      if (role === 'lecturer') {
        if (sessionCheck.rows[0].lecturer_id !== userId) {
          return res.status(403).json({ error: 'Access denied.' });
        }
      } else if (role === 'tutor') {
        const assigned = await pool.query(
          'SELECT session_id FROM session_tutors WHERE session_id = $1 AND tutor_id = $2',
          [sessionId, userId]
        );
        if (!assigned.rows.length) {
          return res.status(403).json({ error: 'Access denied.' });
        }
      }

      const sessionMeta = await pool.query(
        `SELECT module_code, session_type, session_date, start_time, end_time,
                topic, venue, status
         FROM sessions WHERE id = $1`,
        [sessionId]
      );

      const enrolled = await pool.query(
        `SELECT COUNT(*)::int AS count FROM class_list_entries
         WHERE module_code = $1`,
        [sessionMeta.rows[0]?.module_code]
      );

      const result = await pool.query(
        `SELECT al.student_number, al.recorded_at,
                cle.full_name
         FROM attendance_logs al
         LEFT JOIN class_list_entries cle
           ON cle.module_code = $2 AND TRIM(cle.student_number) = TRIM(al.student_number)
         WHERE al.session_id = $1
         ORDER BY al.recorded_at ASC`,
        [sessionId, sessionMeta.rows[0]?.module_code]
      );

      const moduleCode = sessionMeta.rows[0]?.module_code;

      const registerResult = moduleCode
        ? await pool.query(
            `SELECT
               cle.student_number,
               cle.full_name,
               al.recorded_at,
               (al.id IS NOT NULL) AS present
             FROM class_list_entries cle
             LEFT JOIN attendance_logs al
               ON al.session_id = $1
              AND TRIM(al.student_number) = TRIM(cle.student_number)
             WHERE cle.module_code = $2
             ORDER BY present DESC, cle.full_name ASC`,
            [sessionId, moduleCode]
          )
        : { rows: [] };

      const students = registerResult.rows.length
        ? registerResult.rows.map((row) => ({
            student_number: row.student_number,
            full_name:      row.full_name,
            recorded_at:    row.recorded_at,
            present:        row.present,
          }))
        : result.rows.map((row) => ({
            student_number: row.student_number,
            full_name:      row.full_name || '-',
            recorded_at:    row.recorded_at,
            present:        true,
          }));

      return res.status(200).json({
        sessionId,
        count: result.rows.length,
        enrolled: enrolled.rows[0]?.count || 0,
        session: sessionMeta.rows[0] || null,
        attendance: result.rows,
        students,
      });

    } catch (err) {
      console.error('Get attendance error:', err.message);
      return res.status(500).json({ error: 'Server error.' });
    }
  }
);

module.exports = router;
