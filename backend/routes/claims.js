'use strict';

const router       = require('express').Router();
const pool         = require('../db');
const authenticate = require('../middleware/authenticate');
const requireRole  = require('../middleware/requireRole');
const { getRateEntry, getClaimHours } = require('../constants');
const { buildTimesheetPdf } = require('../services/timesheetPdf');
const { sendClaimEmail } = require('../services/mailer');

function claimTutorName(claim) {
  return `${claim.tutor_first_names || ''} ${claim.tutor_surname || ''}`.trim() || 'Tutor';
}

function claimLecturerName(claim) {
  return `${claim.lecturer_first_names || ''} ${claim.lecturer_surname || ''}`.trim() || 'Lecturer';
}

function claimPeriodLabel(claim) {
  return monthYearLabel(claim.period_month, claim.period_year);
}

function claimModuleLabel(claim) {
  return claim.module_code || 'Module';
}

async function loadAdminEmails() {
  const result = await pool.query(
    `SELECT email FROM users WHERE role = 'admin' AND email IS NOT NULL`
  );
  return result.rows.map((r) => r.email).filter(Boolean);
}

function fireClaimEmail({ to, subject, text }) {
  sendClaimEmail({ to, subject, text })
    .then((ok) => {
      if (ok) console.log(`Claim email OK: ${subject}`);
    })
    .catch((err) => {
      console.error(`Claim email error (${subject}):`, err.message);
    });
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const RETURNED_STATUSES = ['returned_by_lecturer', 'returned_by_coordinator'];

function monthYearLabel(month, year) {
  return `${MONTHS[month - 1] || month} ${year}`;
}

function computeEndTime(startTime, sessionType) {
  if (!startTime) return null;
  const start = String(startTime).slice(0, 5);
  const [h, m] = start.split(':').map(Number);
  const mins = sessionType === 'practical' ? 180 : 45;
  const endDate = new Date(2000, 0, 1, h, m + mins);
  return `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`;
}

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

async function loadTutorApplication(tutorId) {
  const result = await pool.query(
    `SELECT qualification_level, responsibility_level, assigned_lecturer_id, module_code
     FROM applications
     WHERE user_id = $1 AND status = 'approved'`,
    [tutorId]
  );
  return result.rows[0] || null;
}

async function resolvePayRate(app) {
  if (!app?.responsibility_level) {
    throw new Error('Your responsibility level has not been assigned yet. Please contact the FYE office.');
  }
  const rateEntry = getRateEntry(app.qualification_level, app.responsibility_level);
  return rateEntry.hourlyRate;
}

async function loadClaimById(claimId) {
  const result = await pool.query(
    `SELECT c.*,
            ut.first_names AS tutor_first_names,
            ut.surname AS tutor_surname,
            ut.email AS tutor_email,
            ul.first_names AS lecturer_first_names,
            ul.surname AS lecturer_surname,
            ul.email AS lecturer_email,
            a.qualification_level,
            a.responsibility_level
     FROM claims c
     JOIN users ut ON ut.id = c.tutor_id
     JOIN users ul ON ul.id = c.lecturer_id
     LEFT JOIN applications a ON a.user_id = c.tutor_id AND a.status = 'approved'
     WHERE c.id = $1`,
    [claimId]
  );
  return result.rows[0] || null;
}

async function assertClaimAccess(claim, userId, role) {
  if (role === 'admin') return true;
  if (role === 'tutor' && claim.tutor_id === userId) return true;
  if (role === 'lecturer' && claim.lecturer_id === userId) return true;
  return false;
}

async function loadValidatedSessions(tutorId, sessionIds, moduleCode) {
  const result = await pool.query(
    `SELECT s.id, s.session_type, s.session_date, s.module_code, s.status
     FROM sessions s
     JOIN session_tutors st ON st.session_id = s.id
     WHERE s.id = ANY($1::int[])
       AND st.tutor_id = $2
       AND s.module_code = $3
       AND s.status = 'completed'`,
    [sessionIds, tutorId, moduleCode]
  );
  return result.rows;
}

function buildSessionLineItems(sessions, payRate) {
  let totalHours = 0;
  const lineItems = sessions.map((session) => {
    const claimedHours = getClaimHours(session.session_type);
    totalHours += claimedHours;
    return { sessionId: session.id, claimedHours };
  });
  totalHours = roundMoney(totalHours);
  const totalAmount = roundMoney(totalHours * payRate);
  return { lineItems, totalHours, totalAmount };
}

async function insertClaimSessions(client, claimId, lineItems) {
  for (const item of lineItems) {
    await client.query(
      `INSERT INTO claim_sessions (claim_id, session_id, claimed_hours, included)
       VALUES ($1, $2, $3, true)`,
      [claimId, item.sessionId, item.claimedHours]
    );
  }
}

async function replaceClaimSessions(client, claimId, lineItems) {
  await client.query('DELETE FROM claim_sessions WHERE claim_id = $1', [claimId]);
  await insertClaimSessions(client, claimId, lineItems);
}

async function loadCompletedSessionsForPeriod(tutorId, moduleCode, periodMonth, periodYear, client = pool) {
  const result = await client.query(
    `SELECT
       s.id,
       s.module_code,
       s.session_date,
       s.start_time,
       s.venue,
       s.topic,
       s.session_type,
       s.status,
       COUNT(DISTINCT al.id)::int AS attendance_count,
       (
         SELECT COUNT(*)::int FROM class_list_entries cle
         WHERE cle.module_code = s.module_code
       ) AS enrolled_count
     FROM sessions s
     JOIN session_tutors st ON st.session_id = s.id AND st.tutor_id = $1
     LEFT JOIN attendance_logs al ON al.session_id = s.id
     WHERE EXTRACT(MONTH FROM s.session_date) = $2
       AND EXTRACT(YEAR FROM s.session_date) = $3
       AND s.module_code = $4
       AND s.status = 'completed'
     GROUP BY s.id
     ORDER BY s.session_date ASC, s.start_time ASC NULLS LAST`,
    [tutorId, periodMonth, periodYear, moduleCode]
  );
  return result.rows;
}

async function syncClaimToCompletedSessions(client, claim, tutorId) {
  const sessions = await loadCompletedSessionsForPeriod(
    tutorId,
    claim.module_code,
    claim.period_month,
    claim.period_year,
    client
  );
  if (!sessions.length) return null;

  const app = await loadTutorApplication(tutorId);
  const payRate = Number(claim.pay_rate) || await resolvePayRate(app);
  const { lineItems, totalHours, totalAmount } = buildSessionLineItems(sessions, payRate);

  await client.query(
    `UPDATE claims
     SET total_hours = $1, total_amount = $2, pay_rate = $3
     WHERE id = $4`,
    [totalHours, totalAmount, payRate, claim.id]
  );
  await replaceClaimSessions(client, claim.id, lineItems);

  return { lineItems, totalHours, totalAmount, sessionCount: sessions.length };
}

// =============================================================
//  GET /api/claims/timesheet
// =============================================================

router.get(
  '/timesheet',
  authenticate,
  requireRole('tutor'),
  async (req, res) => {
    const tutorId = req.user.userId;
    const periodMonth = parseInt(req.query.periodMonth, 10) || (new Date().getMonth() + 1);
    const periodYear  = parseInt(req.query.periodYear, 10) || new Date().getFullYear();
    const moduleCode  = req.query.moduleCode
      ? String(req.query.moduleCode).trim().toUpperCase()
      : null;

    if (periodMonth < 1 || periodMonth > 12) {
      return res.status(400).json({ errors: ['Valid period month (1-12) is required.'] });
    }
    if (!moduleCode) {
      return res.status(400).json({ errors: ['moduleCode is required.'] });
    }

    try {
      const app = await loadTutorApplication(tutorId);
      if (!app) {
        return res.status(403).json({ errors: ['Only approved tutors can view timesheets.'] });
      }

      let payRate;
      try {
        payRate = await resolvePayRate(app);
      } catch (rateErr) {
        return res.status(400).json({ errors: [rateErr.message] });
      }

      const claimResult = await pool.query(
        `SELECT *
         FROM claims
         WHERE tutor_id = $1 AND module_code = $2 AND period_month = $3 AND period_year = $4`,
        [tutorId, moduleCode, periodMonth, periodYear]
      );
      const existingClaim = claimResult.rows[0] || null;

      const sessionRows = await loadCompletedSessionsForPeriod(
        tutorId, moduleCode, periodMonth, periodYear
      );

      let lineItems = [];
      if (existingClaim) {
        const lineResult = await pool.query(
          `SELECT cs.*, s.session_date, s.start_time, s.venue, s.topic, s.session_type, s.module_code
           FROM claim_sessions cs
           JOIN sessions s ON s.id = cs.session_id
           WHERE cs.claim_id = $1 AND cs.included = true
           ORDER BY s.session_date ASC, s.start_time ASC NULLS LAST`,
          [existingClaim.id]
        );
        lineItems = lineResult.rows;
      }

      const claimedSessionIds = lineItems.map((li) => li.session_id);
      const unclaimedSessions = sessionRows.filter((s) => !claimedSessionIds.includes(s.id));

      const sessions = sessionRows.map((row) => {
        const claimedHours = getClaimHours(row.session_type);
        return {
          id:               row.id,
          module_code:      row.module_code,
          session_date:     row.session_date,
          start_time:       row.start_time,
          end_time:         computeEndTime(row.start_time, row.session_type),
          venue:            row.venue,
          topic:            row.topic,
          session_type:     row.session_type,
          attendance_count: row.attendance_count,
          enrolled_count:   row.enrolled_count,
          claimed_hours:    claimedHours,
        };
      });

      const totalHours = existingClaim
        ? Number(existingClaim.total_hours)
        : roundMoney(sessions.reduce((sum, s) => sum + s.claimed_hours, 0));
      const totalAmount = existingClaim
        ? Number(existingClaim.total_amount)
        : roundMoney(totalHours * payRate);

      const lecturerId = app.assigned_lecturer_id || null;
      const pastDue = new Date() > new Date(periodYear, periodMonth - 1, 15, 23, 59, 59);

      const canSubmit = (
        (!existingClaim && sessions.length > 0)
        || (existingClaim && RETURNED_STATUSES.includes(existingClaim.status))
      );
      const canUpdate = Boolean(
        existingClaim
        && existingClaim.status === 'pending_lecturer'
        && unclaimedSessions.length > 0
      );

      return res.status(200).json({
        periodMonth,
        periodYear,
        moduleCode,
        lecturerId,
        sessions,
        lineItems,
        claimedSessionIds,
        unclaimedSessions: unclaimedSessions.map((row) => ({
          id:           row.id,
          session_date: row.session_date,
          topic:        row.topic,
        })),
        claim: existingClaim,
        totalHours,
        totalAmount,
        canSubmit,
        canUpdate,
        pastDue,
        ratePerHour: payRate,
      });
    } catch (err) {
      console.error('Timesheet error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);

// =============================================================
//  GET /api/claims/timesheet/pdf
// =============================================================

router.get(
  '/timesheet/pdf',
  authenticate,
  requireRole('tutor'),
  async (req, res) => {
    const tutorId = req.user.userId;
    const periodMonth = parseInt(req.query.periodMonth, 10) || (new Date().getMonth() + 1);
    const periodYear = parseInt(req.query.periodYear, 10) || new Date().getFullYear();
    const moduleCode = req.query.moduleCode
      ? String(req.query.moduleCode).trim().toUpperCase()
      : null;

    if (periodMonth < 1 || periodMonth > 12) {
      return res.status(400).json({ errors: ['Valid period month (1-12) is required.'] });
    }
    if (!moduleCode) {
      return res.status(400).json({ errors: ['moduleCode is required.'] });
    }

    try {
      const tutorResult = await pool.query(
        `SELECT first_names, surname, student_number FROM users WHERE id = $1`,
        [tutorId]
      );
      const tutor = tutorResult.rows[0];
      if (!tutor) return res.status(404).json({ errors: ['Tutor not found.'] });

      const app = await loadTutorApplication(tutorId);
      if (!app) {
        return res.status(403).json({ errors: ['Only approved tutors can export timesheets.'] });
      }

      let payRate;
      try {
        payRate = await resolvePayRate(app);
      } catch (rateErr) {
        return res.status(400).json({ errors: [rateErr.message] });
      }

      const claimResult = await pool.query(
        `SELECT c.*,
                ul.first_names AS lecturer_first_names,
                ul.surname AS lecturer_surname
         FROM claims c
         JOIN users ul ON ul.id = c.lecturer_id
         WHERE c.tutor_id = $1 AND c.module_code = $2 AND c.period_month = $3 AND c.period_year = $4`,
        [tutorId, moduleCode, periodMonth, periodYear]
      );
      const claim = claimResult.rows[0] || null;

      let sessions = [];
      if (claim) {
        const lineResult = await pool.query(
          `SELECT cs.claimed_hours,
                  s.session_date, s.start_time, s.venue, s.topic, s.session_type,
                  COUNT(DISTINCT al.id)::int AS attendance_count,
                  (
                    SELECT COUNT(*)::int FROM class_list_entries cle
                    WHERE cle.module_code = s.module_code
                  ) AS enrolled_count
           FROM claim_sessions cs
           JOIN sessions s ON s.id = cs.session_id
           LEFT JOIN attendance_logs al ON al.session_id = s.id
           WHERE cs.claim_id = $1 AND cs.included = true
           GROUP BY cs.id, s.id
           ORDER BY s.session_date ASC, s.start_time ASC NULLS LAST`,
          [claim.id]
        );
        sessions = lineResult.rows;
      } else {
        const sessionsResult = await pool.query(
          `SELECT
             s.session_date, s.start_time, s.venue, s.topic, s.session_type,
             COUNT(DISTINCT al.id)::int AS attendance_count,
             (
               SELECT COUNT(*)::int FROM class_list_entries cle
               WHERE cle.module_code = s.module_code
             ) AS enrolled_count
           FROM sessions s
           JOIN session_tutors st ON st.session_id = s.id AND st.tutor_id = $1
           LEFT JOIN attendance_logs al ON al.session_id = s.id
           WHERE EXTRACT(MONTH FROM s.session_date) = $2
             AND EXTRACT(YEAR FROM s.session_date) = $3
             AND s.module_code = $4
             AND s.status = 'completed'
           GROUP BY s.id
           ORDER BY s.session_date ASC, s.start_time ASC NULLS LAST`,
          [tutorId, periodMonth, periodYear, moduleCode]
        );
        sessions = sessionsResult.rows.map((row) => ({
          ...row,
          claimed_hours: getClaimHours(row.session_type),
        }));
      }

      const totalHours = claim
        ? Number(claim.total_hours)
        : roundMoney(sessions.reduce((sum, s) => sum + Number(s.claimed_hours || 0), 0));
      const totalAmount = claim
        ? Number(claim.total_amount)
        : roundMoney(totalHours * payRate);

      const lecturerName = claim
        ? `${claim.lecturer_first_names || ''} ${claim.lecturer_surname || ''}`.trim()
        : null;

      const pdfBuffer = await buildTimesheetPdf({
        periodMonth,
        periodYear,
        moduleCode,
        tutorName: `${tutor.first_names || ''} ${tutor.surname || ''}`.trim(),
        studentNumber: tutor.student_number,
        lecturerName,
        claim,
        sessions,
        totalHours,
        totalAmount,
        payRate: claim?.pay_rate ?? payRate,
      });

      const filename = `VeriFlow_Timesheet_${moduleCode}_${periodMonth}-${periodYear}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(pdfBuffer);
    } catch (err) {
      console.error('Timesheet PDF error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);

// =============================================================
//  GET /api/claims/lecturer
// =============================================================

router.get(
  '/lecturer',
  authenticate,
  requireRole('lecturer'),
  async (req, res) => {
    const lecturerId = req.user.userId;
    const { status, moduleCode } = req.query;

    try {
      const params = [lecturerId];
      let query = `
        SELECT
          c.id,
          c.module_code,
          c.period_month,
          c.period_year,
          c.total_hours,
          c.total_amount,
          c.status,
          c.submitted_at,
          c.lecturer_note,
          c.coordinator_note,
          c.lecturer_reviewed_at,
          c.coordinator_reviewed_at,
          c.pay_rate,
          ut.first_names AS tutor_first_names,
          ut.surname AS tutor_surname,
          ut.student_number,
          COUNT(cs.id)::int AS session_count
        FROM claims c
        JOIN users ut ON ut.id = c.tutor_id
        LEFT JOIN claim_sessions cs ON cs.claim_id = c.id AND cs.included = true
        WHERE c.lecturer_id = $1`;

      if (status) {
        params.push(status);
        query += ` AND c.status = $${params.length}`;
      }
      if (moduleCode) {
        params.push(String(moduleCode).trim().toUpperCase());
        query += ` AND c.module_code = $${params.length}`;
      }

      query += `
        GROUP BY c.id, ut.first_names, ut.surname, ut.student_number
        ORDER BY c.period_year DESC, c.period_month DESC, c.submitted_at DESC NULLS LAST`;

      const result = await pool.query(query, params);
      return res.status(200).json(result.rows);
    } catch (err) {
      console.error('Lecturer claims error:', err.message);
      return res.status(500).json({ error: 'Server error.' });
    }
  }
);

// =============================================================
//  GET /api/claims — tutor list
// =============================================================

router.get(
  '/',
  authenticate,
  requireRole('tutor'),
  async (req, res) => {
    const tutorId = req.user.userId;
    const moduleCode = req.query.moduleCode
      ? String(req.query.moduleCode).trim().toUpperCase()
      : null;

    try {
      const params = [tutorId];
      let query = `
        SELECT
          c.id,
          c.module_code,
          c.period_month,
          c.period_year,
          c.total_hours,
          c.total_amount,
          c.status,
          c.submitted_at,
          c.lecturer_note,
          c.coordinator_note,
          c.lecturer_reviewed_at,
          c.coordinator_reviewed_at,
          ul.first_names AS lecturer_first_names,
          ul.surname AS lecturer_surname,
          COUNT(cs.id)::int AS session_count
        FROM claims c
        JOIN users ul ON ul.id = c.lecturer_id
        LEFT JOIN claim_sessions cs ON cs.claim_id = c.id AND cs.included = true
        WHERE c.tutor_id = $1`;

      if (moduleCode) {
        params.push(moduleCode);
        query += ` AND c.module_code = $${params.length}`;
      }

      query += `
        GROUP BY c.id, ul.first_names, ul.surname
        ORDER BY c.period_year DESC, c.period_month DESC, c.submitted_at DESC NULLS LAST`;

      const result = await pool.query(query, params);
      return res.status(200).json(result.rows);
    } catch (err) {
      console.error('Get tutor claims error:', err.message);
      return res.status(500).json({ error: 'Server error.' });
    }
  }
);

// =============================================================
//  POST /api/claims
// =============================================================

router.post(
  '/',
  authenticate,
  requireRole('tutor'),
  async (req, res) => {
    const tutorId = req.user.userId;
    const { periodMonth, periodYear, lecturerId, sessionIds, moduleCode } = req.body;

    const errors = [];
    if (!periodMonth || periodMonth < 1 || periodMonth > 12) errors.push('Valid period month (1-12) is required.');
    if (!periodYear || periodYear < 2020) errors.push('Valid period year is required.');
    if (!lecturerId) errors.push('Lecturer ID is required.');
    if (!moduleCode) errors.push('Module code is required.');
    if (!sessionIds || !Array.isArray(sessionIds) || sessionIds.length === 0) {
      errors.push('At least one session must be included in the claim.');
    }
    if (errors.length) return res.status(400).json({ errors });

    const mod = String(moduleCode).trim().toUpperCase();

    try {
      const existing = await pool.query(
        `SELECT id, status FROM claims
         WHERE tutor_id = $1 AND module_code = $2 AND period_month = $3 AND period_year = $4`,
        [tutorId, mod, periodMonth, periodYear]
      );
      if (existing.rows.length) {
        return res.status(409).json({
          errors: [`A claim for ${mod} ${monthYearLabel(periodMonth, periodYear)} already exists.`],
        });
      }

      const app = await loadTutorApplication(tutorId);
      if (!app) {
        return res.status(403).json({ errors: ['Only approved tutors can submit claims.'] });
      }

      let payRate;
      try {
        payRate = await resolvePayRate(app);
      } catch (rateErr) {
        return res.status(400).json({ errors: [rateErr.message] });
      }

      if (Number(lecturerId) !== Number(app.assigned_lecturer_id)) {
        return res.status(400).json({ errors: ['Lecturer does not match your assigned lecturer.'] });
      }

      const sessions = await loadValidatedSessions(tutorId, sessionIds, mod);
      if (!sessions.length) {
        return res.status(400).json({ errors: ['No valid completed sessions found for this claim.'] });
      }

      const { lineItems, totalHours, totalAmount } = buildSessionLineItems(sessions, payRate);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const claimResult = await client.query(
          `INSERT INTO claims
             (tutor_id, lecturer_id, module_code, period_month, period_year,
              total_hours, pay_rate, total_amount, status, submitted_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending_lecturer', NOW())
           RETURNING *`,
          [tutorId, lecturerId, mod, periodMonth, periodYear, totalHours, payRate, totalAmount]
        );
        const claim = claimResult.rows[0];
        await insertClaimSessions(client, claim.id, lineItems);
        await client.query('COMMIT');

        const fullClaim = await loadClaimById(claim.id);

        return res.status(201).json({
          message: 'Claim submitted successfully.',
          ...claim,
          sessionCount: lineItems.length,
        });
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('Submit claim error:', err.message);
      return res.status(500).json({ errors: ['Server error. Please try again.'] });
    }
  }
);

// =============================================================
//  PATCH /api/claims/:id/resubmit
// =============================================================

router.patch(
  '/:id/resubmit',
  authenticate,
  requireRole('tutor'),
  async (req, res) => {
    const claimId = parseInt(req.params.id, 10);
    const tutorId = req.user.userId;
    const { sessionIds } = req.body;

    if (!sessionIds || !Array.isArray(sessionIds) || !sessionIds.length) {
      return res.status(400).json({ errors: ['At least one session must be included.'] });
    }

    try {
      const claim = await loadClaimById(claimId);
      if (!claim) return res.status(404).json({ errors: ['Claim not found.'] });
      if (claim.tutor_id !== tutorId) return res.status(403).json({ errors: ['Forbidden.'] });
      if (!RETURNED_STATUSES.includes(claim.status)) {
        return res.status(400).json({ errors: ['Only returned claims can be resubmitted.'] });
      }

      const payRate = Number(claim.pay_rate) || await resolvePayRate(
        await loadTutorApplication(tutorId)
      );
      const sessions = await loadValidatedSessions(tutorId, sessionIds, claim.module_code);
      if (!sessions.length) {
        return res.status(400).json({ errors: ['No valid completed sessions found for this claim.'] });
      }

      const { lineItems, totalHours, totalAmount } = buildSessionLineItems(sessions, payRate);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE claims
           SET status = 'pending_lecturer',
               lecturer_note = NULL,
               coordinator_note = NULL,
               total_hours = $1,
               total_amount = $2,
               pay_rate = $3,
               submitted_at = NOW(),
               lecturer_reviewed_at = NULL,
               coordinator_reviewed_at = NULL
           WHERE id = $4`,
          [totalHours, totalAmount, payRate, claimId]
        );
        await replaceClaimSessions(client, claimId, lineItems);
        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      const updated = await loadClaimById(claimId);

      return res.status(200).json({ message: 'Claim resubmitted.', ...updated });
    } catch (err) {
      console.error('Resubmit claim error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);

// =============================================================
//  PATCH /api/claims/:id/update-sessions
//  Tutor adds newly completed sessions to a pending claim.
// =============================================================

router.patch(
  '/:id/update-sessions',
  authenticate,
  requireRole('tutor'),
  async (req, res) => {
    const claimId = parseInt(req.params.id, 10);
    const tutorId = req.user.userId;
    const { sessionIds } = req.body;

    try {
      const claim = await loadClaimById(claimId);
      if (!claim) return res.status(404).json({ errors: ['Claim not found.'] });
      if (claim.tutor_id !== tutorId) return res.status(403).json({ errors: ['Forbidden.'] });
      if (claim.status !== 'pending_lecturer') {
        return res.status(400).json({
          errors: ['Only claims awaiting lecturer review can be updated.'],
        });
      }

      const ids = Array.isArray(sessionIds) && sessionIds.length
        ? sessionIds
        : (await loadCompletedSessionsForPeriod(
          tutorId,
          claim.module_code,
          claim.period_month,
          claim.period_year
        )).map((s) => s.id);

      if (!ids.length) {
        return res.status(400).json({ errors: ['No completed sessions to include.'] });
      }

      const sessions = await loadValidatedSessions(tutorId, ids, claim.module_code);
      if (!sessions.length) {
        return res.status(400).json({ errors: ['No valid completed sessions found for this claim.'] });
      }

      const payRate = Number(claim.pay_rate) || await resolvePayRate(
        await loadTutorApplication(tutorId)
      );
      const { lineItems, totalHours, totalAmount } = buildSessionLineItems(sessions, payRate);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE claims
           SET total_hours = $1, total_amount = $2, pay_rate = $3, submitted_at = NOW()
           WHERE id = $4`,
          [totalHours, totalAmount, payRate, claimId]
        );
        await replaceClaimSessions(client, claimId, lineItems);
        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      const updated = await loadClaimById(claimId);

      return res.status(200).json({
        message: 'Claim updated with new sessions.',
        ...updated,
        sessionCount: lineItems.length,
      });
    } catch (err) {
      console.error('Update claim sessions error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);

// =============================================================
//  GET /api/claims/:id/sessions
// =============================================================

router.get(
  '/:id/sessions',
  authenticate,
  async (req, res) => {
    const claimId = parseInt(req.params.id, 10);
    const { userId, role } = req.user;

    try {
      const claim = await loadClaimById(claimId);
      if (!claim) return res.status(404).json({ error: 'Claim not found.' });
      if (!(await assertClaimAccess(claim, userId, role))) {
        return res.status(403).json({ error: 'Forbidden.' });
      }

      const sessionsResult = await pool.query(
        `SELECT
           cs.claimed_hours,
           cs.included,
           s.id AS session_id,
           s.session_date,
           s.start_time,
           s.venue,
           s.topic,
           s.session_type,
           s.status AS session_status,
           COUNT(DISTINCT al.id)::int AS attendance_count,
           (
             SELECT COUNT(*)::int FROM class_list_entries cle
             WHERE cle.module_code = s.module_code
           ) AS enrolled_count
         FROM claim_sessions cs
         JOIN sessions s ON s.id = cs.session_id
         LEFT JOIN attendance_logs al ON al.session_id = s.id
         WHERE cs.claim_id = $1
         GROUP BY cs.id, s.id
         ORDER BY s.session_date ASC, s.start_time ASC NULLS LAST`,
        [claimId]
      );

      const sessions = sessionsResult.rows.map((row) => ({
        ...row,
        end_time: computeEndTime(row.start_time, row.session_type),
      }));

      return res.status(200).json({
        claim: {
          id: claim.id,
          tutor_id: claim.tutor_id,
          lecturer_id: claim.lecturer_id,
          module_code: claim.module_code,
          period_month: claim.period_month,
          period_year: claim.period_year,
          total_hours: claim.total_hours,
          pay_rate: claim.pay_rate,
          total_amount: claim.total_amount,
          status: claim.status,
          lecturer_note: claim.lecturer_note,
          coordinator_note: claim.coordinator_note,
          submitted_at: claim.submitted_at,
          lecturer_reviewed_at: claim.lecturer_reviewed_at,
          coordinator_reviewed_at: claim.coordinator_reviewed_at,
          tutor_first_names: claim.tutor_first_names,
          tutor_surname: claim.tutor_surname,
          lecturer_first_names: claim.lecturer_first_names,
          lecturer_surname: claim.lecturer_surname,
          qualification_level: claim.qualification_level,
          responsibility_level: claim.responsibility_level,
        },
        sessions,
      });
    } catch (err) {
      console.error('Claim sessions error:', err.message);
      return res.status(500).json({ error: 'Server error.' });
    }
  }
);

// =============================================================
//  PATCH /api/claims/:id/lecturer-approve
// =============================================================

router.patch(
  '/:id/lecturer-approve',
  authenticate,
  requireRole('lecturer'),
  async (req, res) => {
    const claimId = parseInt(req.params.id, 10);
    const lecturerId = req.user.userId;

    try {
      const claim = await loadClaimById(claimId);
      if (!claim) return res.status(404).json({ errors: ['Claim not found.'] });
      if (claim.lecturer_id !== lecturerId) {
        return res.status(403).json({ errors: ['You can only review claims submitted to you.'] });
      }
      if (claim.status !== 'pending_lecturer') {
        return res.status(400).json({ errors: ['Claim is not awaiting lecturer review.'] });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await syncClaimToCompletedSessions(client, claim, claim.tutor_id);
        const result = await client.query(
          `UPDATE claims
           SET status = 'pending_coordinator', lecturer_reviewed_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [claimId]
        );
        await client.query('COMMIT');

        const updated = result.rows[0];
        const tutor = claimTutorName(claim);
        const lecturer = claimLecturerName(claim);
        const period = claimPeriodLabel(claim);
        const moduleLabel = claimModuleLabel(claim);
        const subject = `Claim ready for approval — ${tutor} · ${moduleLabel} · ${period}`;
        const text =
          `${lecturer} has verified ${tutor}'s ${period} timesheet for ${moduleLabel}. ` +
          'Log in to VeriFlow to review.';

        loadAdminEmails()
          .then((emails) => {
            emails.forEach((email) => {
              fireClaimEmail({ to: email, subject, text });
            });
          })
          .catch((err) => {
            console.error('Could not load admin emails for claim notify:', err.message);
          });

        return res.status(200).json({ message: 'Claim forwarded to coordinator.', ...updated });
      } catch (txErr) {
        await client.query('ROLLBACK').catch(() => {});
        throw txErr;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('Lecturer approve claim error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);

// =============================================================
//  PATCH /api/claims/:id/lecturer-return
// =============================================================

router.patch(
  '/:id/lecturer-return',
  authenticate,
  requireRole('lecturer'),
  async (req, res) => {
    const claimId = parseInt(req.params.id, 10);
    const lecturerId = req.user.userId;
    const { note } = req.body;

    if (!note || !String(note).trim()) {
      return res.status(400).json({ errors: ['Return note is required.'] });
    }

    try {
      const claim = await loadClaimById(claimId);
      if (!claim) return res.status(404).json({ errors: ['Claim not found.'] });
      if (claim.lecturer_id !== lecturerId) {
        return res.status(403).json({ errors: ['You can only review claims submitted to you.'] });
      }
      if (claim.status !== 'pending_lecturer') {
        return res.status(400).json({ errors: ['Claim is not awaiting lecturer review.'] });
      }

      const result = await pool.query(
        `UPDATE claims
         SET status = 'returned_by_lecturer',
             lecturer_note = $1,
             lecturer_reviewed_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [String(note).trim(), claimId]
      );

      const updated = result.rows[0];
      const period = claimPeriodLabel(claim);
      const moduleLabel = claimModuleLabel(claim);
      const returnNote = String(note).trim();

      fireClaimEmail({
        to: claim.tutor_email,
        subject: `Claim returned — ${moduleLabel} · ${period}`,
        text:
          `Your ${period} timesheet for ${moduleLabel} has been returned by your lecturer: ${returnNote}`,
      });

      return res.status(200).json({ message: 'Claim returned to tutor.', ...updated });
    } catch (err) {
      console.error('Lecturer return claim error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);

// =============================================================
//  PATCH /api/claims/:id/coordinator-approve
// =============================================================

router.patch(
  '/:id/coordinator-approve',
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    const claimId = parseInt(req.params.id, 10);

    try {
      const claim = await loadClaimById(claimId);
      if (!claim) return res.status(404).json({ errors: ['Claim not found.'] });
      if (claim.status !== 'pending_coordinator') {
        return res.status(400).json({ errors: ['Claim is not awaiting coordinator approval.'] });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await syncClaimToCompletedSessions(client, claim, claim.tutor_id);
        const result = await client.query(
          `UPDATE claims
           SET status = 'approved', coordinator_reviewed_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [claimId]
        );
        await client.query('COMMIT');

        const updated = result.rows[0];
        const period = claimPeriodLabel(claim);
        const moduleLabel = claimModuleLabel(claim);

        fireClaimEmail({
          to: claim.tutor_email,
          subject: `Claim approved — ${moduleLabel} · ${period}`,
          text:
            `Your ${period} timesheet for ${moduleLabel} has been approved and forwarded to finance.`,
        });

        return res.status(200).json({ message: 'Claim approved.', ...updated });
      } catch (txErr) {
        await client.query('ROLLBACK').catch(() => {});
        throw txErr;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('Coordinator approve claim error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);

// =============================================================
//  PATCH /api/claims/:id/coordinator-return
// =============================================================

router.patch(
  '/:id/coordinator-return',
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    const claimId = parseInt(req.params.id, 10);
    const { note } = req.body;

    if (!note || !String(note).trim()) {
      return res.status(400).json({ errors: ['Return note is required.'] });
    }

    try {
      const claim = await loadClaimById(claimId);
      if (!claim) return res.status(404).json({ errors: ['Claim not found.'] });
      if (!['pending_coordinator', 'approved'].includes(claim.status)) {
        return res.status(400).json({
          errors: ['Only pending or approved claims can be returned to the tutor.'],
        });
      }

      const trimmed = String(note).trim();
      const result = await pool.query(
        `UPDATE claims
         SET status = 'returned_by_coordinator',
             coordinator_note = $1,
             coordinator_reviewed_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [trimmed, claimId]
      );

      const updated = result.rows[0];
      const tutor = claimTutorName(claim);
      const period = claimPeriodLabel(claim);
      const moduleLabel = claimModuleLabel(claim);

      fireClaimEmail({
        to: claim.tutor_email,
        subject: `Claim returned — ${moduleLabel} · ${period}`,
        text:
          `Your ${period} timesheet for ${moduleLabel} has been returned by the coordinator: ${trimmed}`,
      });

      fireClaimEmail({
        to: claim.lecturer_email,
        subject: `Tutor claim returned — ${tutor} · ${moduleLabel}`,
        text:
          `The coordinator returned ${tutor}'s claim for ${moduleLabel} with note: ${trimmed}`,
      });

      return res.status(200).json({ message: 'Claim returned to tutor.', ...updated });
    } catch (err) {
      console.error('Coordinator return claim error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);

module.exports = router;
