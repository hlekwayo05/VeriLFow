'use strict';

const router       = require('express').Router();
const pool         = require('../db');
const authenticate = require('../middleware/authenticate');
const requireRole  = require('../middleware/requireRole');
const {
  rotateQrToken,
  buildAttendanceUrl,
  QR_TOKEN_TTL_SECONDS,
  getActiveSession,
  resolveApiBase,
} = require('../services/qrTokens');
const QRCode = require('qrcode');

// =============================================================
//  Helper — generate a 6-character alphanumeric session code
//  e.g. "A3K9TZ"
// =============================================================

function generateSessionCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function computeEndTime(startTime, sessionType, endTime) {
  if (endTime) return endTime;
  if (!startTime) return null;

  const parts = String(startTime).split(':').map(Number);
  const h = parts[0] || 0;
  const m = parts[1] || 0;
  const addHours = sessionType === 'practical' ? 3 : 2;
  const totalMins = h * 60 + m + addHours * 60;
  const eh = Math.floor(totalMins / 60) % 24;
  const em = totalMins % 60;
  return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}:00`;
}

const SESSION_HOUR_START = 8;
const SESSION_HOUR_END = 20;

function timeToMinutes(timeStr) {
  if (!timeStr) return null;
  const parts = String(timeStr).split(':').map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

function isWithinSessionHours(timeStr) {
  const mins = timeToMinutes(timeStr);
  if (mins == null) return true;
  return mins >= SESSION_HOUR_START * 60 && mins <= SESSION_HOUR_END * 60;
}

async function shouldAutoFlagNoConfirmation() {
  try {
    const result = await pool.query(
      `SELECT value FROM system_settings WHERE key = 'auto_flag_no_confirmation' LIMIT 1`
    );
    if (!result.rows.length) return true;
    const val = String(result.rows[0].value).toLowerCase();
    return val !== 'false' && val !== '0' && val !== 'no';
  } catch {
    return true;
  }
}


// =============================================================
//  POST /api/sessions
//  Lecturer creates a new session.
//  Requires: lecturer JWT
// =============================================================

router.post(
  '/',
  authenticate,
  requireRole('lecturer'),
  async (req, res) => {
    const lecturerId = req.user.userId;
    const { moduleCode, topic, sessionType, sessionDate, startTime, endTime, venue, tutorIds } = req.body;
    // tutorIds: optional array of tutor user IDs to assign to this session

    const errors = [];
    if (!moduleCode   || moduleCode.trim().length === 0)   errors.push('Module code is required.');
    if (!sessionType)                                       errors.push('Session type is required.');
    if (!sessionDate)                                       errors.push('Session date is required.');

    const validTypes = ['tutorial', 'practical', 'online', 'revision', 'lecture'];
    if (sessionType && !validTypes.includes(sessionType)) {
      errors.push(`Session type must be one of: ${validTypes.join(', ')}.`);
    }

    if (errors.length > 0) return res.status(400).json({ errors });

    if (startTime && !isWithinSessionHours(startTime)) {
      errors.push('Start time must be between 08:00 and 20:00.');
    }
    if (endTime && !isWithinSessionHours(endTime)) {
      errors.push('End time must be between 08:00 and 20:00.');
    }
    const resolvedEndTime = computeEndTime(startTime || null, sessionType, endTime || null);
    if (startTime && resolvedEndTime && !isWithinSessionHours(resolvedEndTime)) {
      errors.push('Session must finish by 20:00. Choose an earlier start or end time.');
    }
    if (startTime && endTime && timeToMinutes(endTime) <= timeToMinutes(startTime)) {
      errors.push('End time must be after start time.');
    }
    if (errors.length > 0) return res.status(400).json({ errors });

    try {
      const ownedModule = await pool.query(
        `SELECT module_code FROM lecturer_modules
         WHERE lecturer_id = $1 AND module_code = $2
         LIMIT 1`,
        [lecturerId, moduleCode.trim().toUpperCase()]
      );
      if (ownedModule.rows.length === 0) {
        return res.status(403).json({
          errors: ['You are not assigned to this module.'],
        });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const sessionResult = await client.query(
          `INSERT INTO sessions
             (lecturer_id, module_code, topic, session_type,
              session_date, start_time, end_time, venue, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled')
           RETURNING id`,
          [
            lecturerId,
            moduleCode.trim().toUpperCase(),
            topic ? topic.trim() : null,
            sessionType,
            sessionDate,
            startTime || null,
            resolvedEndTime,
            venue ? venue.trim() : null,
          ]
        );

        const sessionId = sessionResult.rows[0].id;

        // Assign tutors if provided
        if (tutorIds && Array.isArray(tutorIds) && tutorIds.length > 0) {
          for (const tutorId of tutorIds) {
            await client.query(
              `INSERT INTO session_tutors (session_id, tutor_id)
               VALUES ($1, $2)
               ON CONFLICT DO NOTHING`,
              [sessionId, tutorId]
            );
          }
        }

        await client.query('COMMIT');

        return res.status(201).json({
          message: 'Session created successfully.',
          sessionId,
        });

      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

    } catch (err) {
      console.error('Create session error:', err.message);
      return res.status(500).json({ errors: ['Server error. Please try again.'] });
    }
  }
);


// =============================================================
//  GET /api/sessions
//  Lecturer sees their own sessions.
//  Admin sees all sessions.
//  Tutor sees sessions they are assigned to.
//  Requires: any authenticated user
// =============================================================

router.get(
  '/',
  authenticate,
  async (req, res) => {
    const { userId, role } = req.user;
    const moduleCode = req.query.moduleCode
      ? String(req.query.moduleCode).trim().toUpperCase()
      : null;

    try {
      let query;
      let params = [];

      if (role === 'admin') {
        params = [];
        query = `
          SELECT
            s.id,
            s.module_code,
            s.topic,
            s.session_type,
            s.session_date,
            s.start_time,
            s.end_time,
            s.venue,
            s.session_code,
            s.code_expires_at,
            s.status,
            s.created_at,
            u.first_names AS lecturer_first_names,
            u.surname     AS lecturer_surname,
            COUNT(al.id)  AS attendance_count,
            (SELECT STRING_AGG(DISTINCT ut.first_names || ' ' || ut.surname, ', ' ORDER BY ut.first_names || ' ' || ut.surname)
             FROM session_tutors st
             JOIN users ut ON ut.id = st.tutor_id
             WHERE st.session_id = s.id)
              AS tutor_names
          FROM sessions s
          JOIN users u ON u.id = s.lecturer_id
          LEFT JOIN attendance_logs al ON al.session_id = s.id
          WHERE 1=1`;
        if (moduleCode) {
          params.push(moduleCode);
          query += ` AND s.module_code = $${params.length}`;
        }
        query += `
          GROUP BY s.id, u.first_names, u.surname
          ORDER BY s.session_date DESC
        `;

      } else if (role === 'lecturer') {
        params = [userId];
        query = `
          SELECT
            s.id,
            s.module_code,
            s.topic,
            s.session_type,
            s.session_date,
            s.start_time,
            s.end_time,
            s.venue,
            s.session_code,
            s.code_expires_at,
            s.status,
            s.created_at,
            COUNT(DISTINCT al.id) AS attendance_count,
            (SELECT COUNT(*)::int FROM session_tutors stc WHERE stc.session_id = s.id)
              AS tutor_assigned_count,
            (SELECT COUNT(*)::int FROM session_tutors stc
             WHERE stc.session_id = s.id AND stc.confirmed_at IS NOT NULL)
              AS tutor_confirmed_count,
            (SELECT STRING_AGG(DISTINCT ut2.first_names || ' ' || ut2.surname, ', ' ORDER BY ut2.first_names || ' ' || ut2.surname)
             FROM session_tutors st2
             JOIN users ut2 ON ut2.id = st2.tutor_id
             WHERE st2.session_id = s.id)
              AS tutor_names,
            (SELECT STRING_AGG(DISTINCT utc.first_names || ' ' || utc.surname, ', ' ORDER BY utc.first_names || ' ' || utc.surname)
             FROM session_tutors stc2
             JOIN users utc ON utc.id = stc2.tutor_id
             WHERE stc2.session_id = s.id AND stc2.confirmed_at IS NOT NULL)
              AS tutor_confirmed_names
          FROM sessions s
          LEFT JOIN attendance_logs al ON al.session_id = s.id
          WHERE s.lecturer_id = $1`;
        if (moduleCode) {
          params.push(moduleCode);
          query += ` AND s.module_code = $${params.length}`;
        }
        query += `
          GROUP BY s.id
          ORDER BY s.session_date DESC
        `;

      } else {
        // Tutor — only sessions they are assigned to
        params = [userId];
        query = `
          SELECT
            s.id,
            s.module_code,
            s.topic,
            s.session_type,
            s.session_date,
            s.start_time,
            s.end_time,
            s.venue,
            s.session_code,
            s.status,
            s.created_at,
            u.first_names AS lecturer_first_names,
            u.surname     AS lecturer_surname,
            COUNT(DISTINCT al.id) AS attendance_count,
            st.confirmed_at AS my_confirmed_at,
            st.declined_at  AS my_declined_at
          FROM sessions s
          JOIN session_tutors st ON st.session_id = s.id AND st.tutor_id = $1
          JOIN users u ON u.id = s.lecturer_id
          LEFT JOIN attendance_logs al ON al.session_id = s.id
          WHERE 1=1`;
        if (moduleCode) {
          params.push(moduleCode);
          query += ` AND s.module_code = $${params.length}`;
        }
        query += `
          GROUP BY s.id, u.first_names, u.surname, st.confirmed_at, st.declined_at
          ORDER BY s.session_date DESC
        `;
      }

      const result = await pool.query(query, params);
      return res.status(200).json(result.rows);

    } catch (err) {
      console.error('Get sessions error:', err.message);
      return res.status(500).json({ error: 'Server error.' });
    }
  }
);


// =============================================================
//  GET /api/sessions/:id/qr
//  Returns a rotating QR token for an active session.
//  Requires: lecturer (owner) or assigned tutor JWT
// =============================================================

router.get(
  '/:id/qr',
  authenticate,
  requireRole('admin', 'lecturer', 'tutor'),
  async (req, res) => {
    const sessionId = parseInt(req.params.id);
    const { userId, role } = req.user;

    try {
      const session = await getActiveSession(sessionId);
      if (!session) {
        return res.status(404).json({ errors: ['Session not found.'] });
      }

      if (session.status !== 'active') {
        return res.status(409).json({
          errors: ['Session must be activated before opening the attendance register.'],
        });
      }

      if (role === 'lecturer') {
        const owned = await pool.query(
          'SELECT id FROM sessions WHERE id = $1 AND lecturer_id = $2',
          [sessionId, userId]
        );
        if (!owned.rows.length) {
          return res.status(403).json({ errors: ['You do not have access to this session.'] });
        }
      } else if (role === 'tutor') {
        const assigned = await pool.query(
          'SELECT session_id FROM session_tutors WHERE session_id = $1 AND tutor_id = $2',
          [sessionId, userId]
        );
        if (!assigned.rows.length) {
          return res.status(403).json({ errors: ['You are not assigned to this session.'] });
        }
      }

      const qr = await rotateQrToken(sessionId);
      const expiresAt = new Date(qr.expires_at);
      const secondsRemaining = Math.max(
        0,
        Math.floor((expiresAt.getTime() - Date.now()) / 1000)
      );
      const attendanceUrl = buildAttendanceUrl(qr.token);
      const qrDataUrl = await QRCode.toDataURL(attendanceUrl, {
        width: 280,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
      });

      return res.status(200).json({
        sessionId,
        qrToken:          qr.token,
        attendanceUrl,
        qrDataUrl,
        networkUrl:       attendanceUrl,
        apiBaseUrl:       resolveApiBase(),
        expiresAt:        expiresAt.toISOString(),
        secondsRemaining,
        rotationSeconds:  QR_TOKEN_TTL_SECONDS,
        moduleCode:       session.module_code,
        topic:            session.topic,
        sessionType:      session.session_type,
        sessionDate:      session.session_date,
        startTime:        session.start_time,
        venue:            session.venue,
      });

    } catch (err) {
      console.error('Get session QR error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);


// =============================================================
//  GET /api/sessions/:id
//  Returns full detail for one session including assigned tutors
//  and attendance log.
//  Requires: lecturer or admin JWT
// =============================================================

router.get(
  '/:id',
  authenticate,
  requireRole('admin', 'lecturer'),
  async (req, res) => {
    const sessionId = parseInt(req.params.id);

    try {
      const sessionResult = await pool.query(
        `SELECT
           s.*,
           u.first_names AS lecturer_first_names,
           u.surname     AS lecturer_surname
         FROM sessions s
         JOIN users u ON u.id = s.lecturer_id
         WHERE s.id = $1`,
        [sessionId]
      );

      if (sessionResult.rows.length === 0) {
        return res.status(404).json({ error: 'Session not found.' });
      }

      // Assigned tutors
      const tutorsResult = await pool.query(
        `SELECT u.id, u.first_names, u.surname, u.student_number,
                st.confirmed_at, st.declined_at
         FROM session_tutors st
         JOIN users u ON u.id = st.tutor_id
         WHERE st.session_id = $1
         ORDER BY u.surname ASC`,
        [sessionId]
      );

      // Attendance log
      const attendanceResult = await pool.query(
        `SELECT student_number, recorded_at
         FROM attendance_logs
         WHERE session_id = $1
         ORDER BY recorded_at ASC`,
        [sessionId]
      );

      return res.status(200).json({
        ...sessionResult.rows[0],
        tutors:     tutorsResult.rows,
        attendance: attendanceResult.rows,
      });

    } catch (err) {
      console.error('Get session detail error:', err.message);
      return res.status(500).json({ error: 'Server error.' });
    }
  }
);


// =============================================================
//  PATCH /api/sessions/:id/availability
//  Tutor confirms or declines availability for an assigned session.
//  Requires: tutor JWT
// =============================================================

router.patch(
  '/:id/availability',
  authenticate,
  requireRole('tutor'),
  async (req, res) => {
    const sessionId = parseInt(req.params.id);
    const tutorId     = req.user.userId;
    const { available } = req.body;

    if (typeof available !== 'boolean') {
      return res.status(400).json({ errors: ['available must be true or false.'] });
    }

    try {
      const check = await pool.query(
        `SELECT st.session_id, s.status
         FROM session_tutors st
         JOIN sessions s ON s.id = st.session_id
         WHERE st.session_id = $1 AND st.tutor_id = $2`,
        [sessionId, tutorId]
      );

      if (check.rows.length === 0) {
        return res.status(404).json({ errors: ['Session not found or you are not assigned.'] });
      }

      if (check.rows[0].status === 'completed') {
        return res.status(409).json({ errors: ['Session is already completed.'] });
      }

      if (available) {
        await pool.query(
          `UPDATE session_tutors
           SET confirmed_at = NOW(), declined_at = NULL
           WHERE session_id = $1 AND tutor_id = $2`,
          [sessionId, tutorId]
        );
      } else {
        await pool.query(
          `UPDATE session_tutors
           SET declined_at = NOW(), confirmed_at = NULL
           WHERE session_id = $1 AND tutor_id = $2`,
          [sessionId, tutorId]
        );
      }

      return res.status(200).json({
        message: available ? 'Availability confirmed.' : 'Unavailability recorded.',
      });

    } catch (err) {
      console.error('Session availability error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);


// =============================================================
//  PATCH /api/sessions/:id/activate
//  Lecturer activates a session — generates a session code.
//  Code expires when the lecturer completes the session.
//  Requires: lecturer JWT
// =============================================================

router.patch(
  '/:id/activate',
  authenticate,
  requireRole('lecturer'),
  async (req, res) => {
    const sessionId  = parseInt(req.params.id);
    const lecturerId = req.user.userId;

    try {
      // Confirm this session belongs to this lecturer
      const check = await pool.query(
        'SELECT id, status FROM sessions WHERE id = $1 AND lecturer_id = $2',
        [sessionId, lecturerId]
      );

      if (check.rows.length === 0) {
        return res.status(404).json({ errors: ['Session not found.'] });
      }
      if (check.rows[0].status === 'completed') {
        return res.status(409).json({ errors: ['Session is already completed.'] });
      }

      // Generate a unique session code
      let code;
      let unique = false;
      while (!unique) {
        code = generateSessionCode();
        const existing = await pool.query(
          'SELECT id FROM sessions WHERE session_code = $1',
          [code]
        );
        if (existing.rows.length === 0) unique = true;
      }

      // Code expires 4 hours from now — enough for any session type
      const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000);

      await pool.query(
        `UPDATE sessions
         SET session_code    = $1,
             code_expires_at = $2,
             status          = 'active'
         WHERE id = $3`,
        [code, expiresAt, sessionId]
      );

      return res.status(200).json({
        message:        'Session activated.',
        sessionCode:    code,
        codeExpiresAt:  expiresAt,
      });

    } catch (err) {
      console.error('Activate session error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);


// =============================================================
//  PATCH /api/sessions/:id/complete
//  Lecturer marks a session as completed.
//  Clears the session code so it can no longer be used.
//  Requires: lecturer JWT
// =============================================================

router.patch(
  '/:id/complete',
  authenticate,
  requireRole('lecturer'),
  async (req, res) => {
    const sessionId  = parseInt(req.params.id);
    const lecturerId = req.user.userId;

    try {
      const check = await pool.query(
        'SELECT id, status FROM sessions WHERE id = $1 AND lecturer_id = $2',
        [sessionId, lecturerId]
      );

      if (check.rows.length === 0) {
        return res.status(404).json({ errors: ['Session not found.'] });
      }
      if (check.rows[0].status === 'completed') {
        return res.status(409).json({ errors: ['Session is already completed.'] });
      }

      const confirmedResult = await pool.query(
        `SELECT COUNT(*)::int AS count FROM session_tutors
         WHERE session_id = $1 AND confirmed_at IS NOT NULL`,
        [sessionId]
      );
      const confirmedCount = confirmedResult.rows[0]?.count || 0;
      const autoFlag = await shouldAutoFlagNoConfirmation();
      const finalStatus = autoFlag && confirmedCount === 0 ? 'flagged' : 'completed';

      await pool.query(
        `UPDATE sessions
         SET status          = $2,
             session_code    = NULL,
             code_expires_at = NULL
         WHERE id = $1`,
        [sessionId, finalStatus]
      );

      if (finalStatus === 'flagged') {
        console.log(`Session ${sessionId} flagged: no tutor confirmed availability.`);
      }

      return res.status(200).json({
        message: finalStatus === 'flagged'
          ? 'Session flagged — no tutor confirmed availability.'
          : 'Session marked as completed.',
        status: finalStatus,
      });

    } catch (err) {
      console.error('Complete session error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);


// =============================================================
//  PATCH /api/sessions/:id/resolve-flag
//  Admin clears a flagged session (marks completed).
//  Requires: admin JWT
// =============================================================

router.patch(
  '/:id/resolve-flag',
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    const sessionId = parseInt(req.params.id, 10);
    const note = req.body.note ? String(req.body.note).trim() : null;

    if (!sessionId) return res.status(400).json({ errors: ['Invalid session id.'] });

    try {
      const check = await pool.query(
        'SELECT id, status FROM sessions WHERE id = $1',
        [sessionId]
      );
      if (!check.rows.length) {
        return res.status(404).json({ errors: ['Session not found.'] });
      }
      if (check.rows[0].status !== 'flagged') {
        return res.status(409).json({ errors: ['Session is not flagged.'] });
      }

      await pool.query(
        `UPDATE sessions
         SET status = 'completed',
             session_code = NULL,
             code_expires_at = NULL
         WHERE id = $1`,
        [sessionId]
      );

      return res.status(200).json({
        message: 'Flagged session resolved.',
        sessionId,
        note,
      });
    } catch (err) {
      console.error('Resolve flagged session error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);

module.exports = router;