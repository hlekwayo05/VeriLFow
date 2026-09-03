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
const { parsePagination, sendList } = require('../utils/pagination');
const { cacheGet, cacheSet, cacheDelPrefix } = require('../services/cache');


function generateSessionCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function invalidateSessionCaches() {
  cacheDelPrefix('sessions:');
}

async function assertSessionAccess(req, res, sessionId) {
  const sessionResult = await pool.query(
    'SELECT * FROM sessions WHERE id = $1',
    [sessionId]
  );

  if (sessionResult.rows.length === 0) {
    res.status(404).json({ errors: ['Session not found.'] });
    return null;
  }

  const s = sessionResult.rows[0];
  const { userId, role } = req.user;

  if (role === 'admin') {
    return s;
  }

  if (role === 'lecturer') {
    if (s.lecturer_id !== userId) {
      res.status(403).json({ errors: ['You do not have access to this session.'] });
      return null;
    }
    return s;
  }

  if (role === 'tutor') {
    const assigned = await pool.query(
      `SELECT 1 FROM session_tutors
       WHERE session_id = $1 AND tutor_id = $2`,
      [sessionId, userId]
    );
    if (assigned.rows.length === 0) {
      res.status(403).json({ errors: ['You are not assigned to this session.'] });
      return null;
    }
    return s;
  }

  res.status(403).json({ errors: ['Forbidden'] });
  return null;
}

function computeEndTime(startTime, sessionType, endTime) {
  if (endTime) return normalizeTime(endTime);
  if (!startTime) return null;

  const startMins = timeToMinutes(startTime);
  if (startMins == null) return null;
  const addHours = sessionType === 'practical' ? 3 : 2;
  const totalMins = Math.min(startMins + addHours * 60, SESSION_HOUR_END * 60);
  const eh = Math.floor(totalMins / 60) % 24;
  const em = totalMins % 60;
  return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}:00`;
}

const SESSION_HOUR_START = 8;
const SESSION_HOUR_END = 20;

function normalizeTime(timeStr) {
  if (timeStr == null || timeStr === '') return null;
  const raw = String(timeStr).trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function timeToMinutes(timeStr) {
  const normalized = normalizeTime(timeStr);
  if (!normalized) return null;
  const [h, m] = normalized.split(':').map(Number);
  return h * 60 + m;
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

        invalidateSessionCaches();
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


router.get(
  '/',
  authenticate,
  async (req, res) => {
    const { userId, role } = req.user;
    const moduleCode = req.query.moduleCode
      ? String(req.query.moduleCode).trim().toUpperCase()
      : null;
    const pagination = parsePagination(req.query);
    const cacheKey = `sessions:${role}:${userId}:${moduleCode || '*'}:${pagination.enabled ? `${pagination.page}:${pagination.limit}` : 'all'}`;

    try {
      const cached = cacheGet(cacheKey);
      if (cached !== undefined) {
        return sendList(res, cached.rows, pagination, cached.total);
      }

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
        // Tutor - only sessions they are assigned to
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

      const countResult = await pool.query(
        `SELECT COUNT(*)::int AS total FROM (${query}) AS sessions_count`,
        params
      );
      const total = countResult.rows[0]?.total || 0;

      if (pagination.enabled) {
        params.push(pagination.limit, pagination.offset);
        query += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
      }

      const result = await pool.query(query, params);
      cacheSet(cacheKey, { rows: result.rows, total });
      return sendList(res, result.rows, pagination, total);

    } catch (err) {
      console.error('Get sessions error:', err.message);
      return res.status(500).json({ error: 'Server error.' });
    }
  }
);


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

      if (role === 'lecturer' || role === 'tutor') {
        const allowed = await assertSessionAccess(req, res, sessionId);
        if (!allowed) return;
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


router.get(
  '/:id',
  authenticate,
  requireRole('admin', 'lecturer', 'tutor'),
  async (req, res) => {
    const sessionId = parseInt(req.params.id);

    try {
      const s = await assertSessionAccess(req, res, sessionId);
      if (!s) return;

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
      const s = await assertSessionAccess(req, res, sessionId);
      if (!s) return;

      if (s.status === 'completed') {
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


router.patch(
  '/:id/activate',
  authenticate,
  requireRole('lecturer'),
  async (req, res) => {
    const sessionId  = parseInt(req.params.id);
    const lecturerId = req.user.userId;

    try {
      const s = await assertSessionAccess(req, res, sessionId);
      if (!s) return;

      if (s.status === 'completed') {
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

      // Code expires 4 hours from now - enough for any session type
      const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000);

      await pool.query(
        `UPDATE sessions
         SET session_code    = $1,
             code_expires_at = $2,
             status          = 'active'
         WHERE id = $3`,
        [code, expiresAt, sessionId]
      );

      invalidateSessionCaches();
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


router.patch(
  '/:id/complete',
  authenticate,
  requireRole('lecturer'),
  async (req, res) => {
    const sessionId  = parseInt(req.params.id);
    const lecturerId = req.user.userId;

    try {
      const s = await assertSessionAccess(req, res, sessionId);
      if (!s) return;

      if (s.status === 'completed') {
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

      invalidateSessionCaches();
      return res.status(200).json({
        message: finalStatus === 'flagged'
          ? 'Session flagged - no tutor confirmed availability.'
          : 'Session marked as completed.',
        status: finalStatus,
      });

    } catch (err) {
      console.error('Complete session error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);


router.patch(
  '/:id/cancel',
  authenticate,
  requireRole('lecturer'),
  async (req, res) => {
    const sessionId = parseInt(req.params.id, 10);

    try {
      const s = await assertSessionAccess(req, res, sessionId);
      if (!s) return;

      if (s.status === 'cancelled') {
        return res.status(409).json({ errors: ['Session is already cancelled.'] });
      }
      if (s.status === 'completed' || s.status === 'flagged') {
        return res.status(409).json({ errors: ['Completed or flagged sessions cannot be cancelled.'] });
      }

      await pool.query(
        `UPDATE sessions
         SET status          = 'cancelled',
             session_code    = NULL,
             code_expires_at = NULL
         WHERE id = $1`,
        [sessionId]
      );

      invalidateSessionCaches();
      return res.status(200).json({
        message: 'Session cancelled.',
        status: 'cancelled',
      });
    } catch (err) {
      console.error('Cancel session error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);


router.patch(
  '/:id/postpone',
  authenticate,
  requireRole('lecturer'),
  async (req, res) => {
    const sessionId = parseInt(req.params.id, 10);
    const { sessionDate, startTime, endTime, venue } = req.body || {};

    try {
      const s = await assertSessionAccess(req, res, sessionId);
      if (!s) return;

      if (s.status === 'cancelled') {
        return res.status(409).json({ errors: ['Cancelled sessions cannot be postponed.'] });
      }
      if (s.status === 'completed' || s.status === 'flagged') {
        return res.status(409).json({ errors: ['Completed or flagged sessions cannot be postponed.'] });
      }
      if (!sessionDate) {
        return res.status(400).json({ errors: ['New session date is required.'] });
      }

      const errors = [];
      const normalizedStart = normalizeTime(startTime) || normalizeTime(s.start_time);
      let normalizedEnd = normalizeTime(endTime);

      // If end is missing, before start, or outside hours, auto-calc from start (capped at 20:00)
      if (normalizedStart) {
        const startMins = timeToMinutes(normalizedStart);
        const endMins = normalizedEnd ? timeToMinutes(normalizedEnd) : null;
        const needsAutoEnd =
          !normalizedEnd ||
          endMins == null ||
          endMins <= startMins ||
          !isWithinSessionHours(normalizedEnd);
        if (needsAutoEnd) {
          normalizedEnd = normalizeTime(
            computeEndTime(normalizedStart, s.session_type || 'tutorial', null)
          );
        }
      }

      if (normalizedStart && !isWithinSessionHours(normalizedStart)) {
        errors.push('Start time must be between 08:00 and 20:00.');
      }
      if (normalizedEnd && !isWithinSessionHours(normalizedEnd)) {
        errors.push('End time must be between 08:00 and 20:00.');
      }
      if (normalizedStart && normalizedEnd && timeToMinutes(normalizedEnd) <= timeToMinutes(normalizedStart)) {
        errors.push('End time must be after start time.');
      }
      if (errors.length) return res.status(400).json({ errors });

      const resolvedStart = normalizedStart || s.start_time || null;
      const resolvedEndTime = normalizedEnd
        ? `${normalizedEnd}:00`
        : computeEndTime(resolvedStart, s.session_type || 'tutorial', null);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        await client.query(
          `UPDATE sessions
           SET session_date    = $2,
               start_time      = $3,
               end_time        = $4,
               venue           = COALESCE($5, venue),
               status          = 'scheduled',
               session_code    = NULL,
               code_expires_at = NULL
           WHERE id = $1`,
          [
            sessionId,
            sessionDate,
            resolvedStart,
            resolvedEndTime,
            venue != null && String(venue).trim() !== '' ? String(venue).trim() : null,
          ]
        );

        // Tutors must re-confirm for the new date/time
        await client.query(
          `UPDATE session_tutors
           SET confirmed_at = NULL,
               declined_at  = NULL
           WHERE session_id = $1`,
          [sessionId]
        );

        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      invalidateSessionCaches();
      return res.status(200).json({
        message: 'Session postponed.',
        status: 'scheduled',
        sessionDate,
      });
    } catch (err) {
      console.error('Postpone session error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);


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
