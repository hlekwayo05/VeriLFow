'use strict';

const router       = require('express').Router();
const bcrypt       = require('bcrypt');
const pool         = require('../db');
const authenticate = require('../middleware/authenticate');
const requireRole  = require('../middleware/requireRole');
const { adminActionLimiter } = require('../middleware/rateLimiter');
const { getRateEntry } = require('../constants');
const { generateTempPassword } = require('../utils/tempPassword');
const {
  sendReferralNotificationEmail,
  sendReferralApprovalEmail,
  sendReferralApprovalNoPasswordEmail,
  referralLoginLink,
} = require('../services/mailer');

const BCRYPT_COST = 12;

const COURSE_MAP = {
  BICT: 'BICT — Bachelor of ICT',
  DICT: 'DICT — Diploma in ICT',
};

const QUALIFICATION_MAP = {
  '3rd year student':            '3rd_year',
  '4th year or Honours student': '4th_year_honours',
  'Masters student':             'masters',
  'Masters Holder':              'masters_holder',
  'PhD Candidate or Holder':     'phd',
};


router.post(
  '/',
  authenticate,
  requireRole('lecturer'),
  async (req, res) => {
    const {
      firstName,
      surname,
      email,
      course,
      moduleCode,
      qualificationLevel,
    } = req.body;

    const lecturerId = req.user.userId;

    const errors = [];

    if (!firstName || firstName.trim().length === 0) errors.push('First name is required.');
    if (!surname   || surname.trim().length === 0)   errors.push('Surname is required.');
    if (!email     || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push('Valid email is required.');
    }
    if (!course || !COURSE_MAP[course]) {
      errors.push('Course must be BICT or DICT.');
    }
    if (!moduleCode || moduleCode.trim().length === 0) {
      errors.push('Module code is required.');
    }
    if (!qualificationLevel || !QUALIFICATION_MAP[qualificationLevel]) {
      errors.push('Valid qualification level is required.');
    }

    if (errors.length > 0) return res.status(400).json({ errors });

    const fullCourse       = COURSE_MAP[course];
    const qualEnum         = QUALIFICATION_MAP[qualificationLevel];
    const normalisedEmail  = email.toLowerCase().trim();
    const normalisedModule = moduleCode.trim().toUpperCase();

    try {
      const modResult = await pool.query(
        `SELECT module_name
         FROM lecturer_modules
         WHERE lecturer_id = $1
           AND course = $2
           AND UPPER(module_code) = $3`,
        [lecturerId, fullCourse, normalisedModule]
      );

      if (modResult.rows.length === 0) {
        return res.status(403).json({
          errors: ['You can only refer tutors for modules assigned to you.'],
        });
      }

      const moduleName = modResult.rows[0].module_name;

      const pending = await pool.query(
        `SELECT id FROM referrals
         WHERE LOWER(email) = $1
           AND UPPER(module_code) = $2
           AND status = 'pending'`,
        [normalisedEmail, normalisedModule]
      );
      if (pending.rows.length > 0) {
        return res.status(409).json({
          errors: ['A pending referral already exists for this email and module.'],
        });
      }

      const approved = await pool.query(
        `SELECT u.id
         FROM users u
         JOIN applications a ON a.user_id = u.id
         WHERE LOWER(u.email) = $1
           AND a.course = $2
           AND a.module_name = $3
           AND a.status = 'approved'`,
        [normalisedEmail, fullCourse, moduleName]
      );
      if (approved.rows.length > 0) {
        return res.status(409).json({
          errors: ['This person is already an approved tutor for this module.'],
        });
      }

      const result = await pool.query(
        `INSERT INTO referrals
           (lecturer_id, first_names, surname, email, course,
            module_code, module_name, qualification_level)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, status, created_at`,
        [
          lecturerId,
          firstName.trim(),
          surname.trim(),
          normalisedEmail,
          fullCourse,
          normalisedModule,
          moduleName,
          qualEnum,
        ]
      );

      const lecResult = await pool.query(
        `SELECT first_names, surname FROM users WHERE id = $1`,
        [lecturerId]
      );
      const lec = lecResult.rows[0] || {};
      const lecturerName = `${lec.first_names || ''} ${lec.surname || ''}`.trim() || 'Your lecturer';

      try {
        await sendReferralNotificationEmail({
          studentEmail:     normalisedEmail,
          studentFirstName: firstName.trim(),
          lecturerName,
          moduleCode:       normalisedModule,
          moduleName,
        });
        console.log(`Referral notification email sent to ${normalisedEmail}`);
      } catch (err) {
        console.error(`Referral notification email failed (${normalisedEmail}):`, err.message);
      }

      return res.status(201).json({
        message: 'Referral submitted successfully.',
        referral: result.rows[0],
      });

    } catch (err) {
      console.error('Create referral error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);


router.get(
  '/',
  authenticate,
  requireRole('admin', 'lecturer'),
  async (req, res) => {
    const { status } = req.query;
    const { userId, role } = req.user;

    try {
      // Remove approved referrals whose tutor account was deactivated.
      try {
        await pool.query(
          `DELETE FROM referrals r
           WHERE r.status = 'approved'
             AND NOT EXISTS (
               SELECT 1 FROM users u
               WHERE LOWER(u.email) = LOWER(r.email) AND u.role = 'tutor'
             )`
        );
      } catch (cleanupErr) {
        if (cleanupErr.code !== '42P01') {
          console.error('Referral orphan cleanup:', cleanupErr.message);
        }
      }

      let query = `
        SELECT
          r.id,
          r.first_names,
          r.surname,
          r.email,
          r.course,
          r.module_code,
          r.module_name,
          r.qualification_level,
          r.status,
          r.responsibility_level,
          r.rejection_reason,
          r.reviewed_at,
          r.created_at,
          lec.title  AS lecturer_title,
          lec.first_names AS lecturer_first_names,
          lec.surname     AS lecturer_surname,
          app.gpa
        FROM referrals r
        JOIN users lec ON lec.id = r.lecturer_id
        LEFT JOIN users tu
          ON LOWER(tu.email) = LOWER(r.email) AND tu.role = 'tutor'
        LEFT JOIN applications app
          ON app.user_id = tu.id
         AND app.course = r.course
         AND app.module_name = r.module_name
        WHERE (r.status <> 'approved' OR tu.id IS NOT NULL)`;

      const params = [];

      if (role === 'lecturer') {
        params.push(userId);
        query += ` AND r.lecturer_id = $${params.length}`;
      }

      if (status) {
        params.push(status);
        query += ` AND r.status = $${params.length}`;
      }

      query += ' ORDER BY r.created_at DESC';

      const result = await pool.query(query, params);
      return res.status(200).json(result.rows);

    } catch (err) {
      console.error('Get referrals error:', err.message);
      return res.status(500).json({ error: 'Server error.' });
    }
  }
);


router.patch(
  '/:id/approve',
  adminActionLimiter,
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    const referralId = parseInt(req.params.id);
    const { responsibilityLevel } = req.body;
    const adminId = req.user.userId;

    if (!['standard', 'senior', 'lead'].includes(responsibilityLevel)) {
      return res.status(400).json({
        errors: ['Responsibility level must be standard, senior, or lead.'],
      });
    }

    try {
      const refResult = await pool.query(
        `SELECT id, lecturer_id, first_names, surname, email, course,
                module_code, module_name, qualification_level, status
         FROM referrals
         WHERE id = $1`,
        [referralId]
      );

      if (refResult.rows.length === 0) {
        return res.status(404).json({ errors: ['Referral not found.'] });
      }

      const referral = refResult.rows[0];

      if (referral.status !== 'pending') {
        return res.status(409).json({
          errors: ['This referral is not pending approval.'],
        });
      }

      try {
        getRateEntry(referral.qualification_level, responsibilityLevel);
      } catch (rateErr) {
        return res.status(400).json({ errors: [rateErr.message] });
      }

      const client = await pool.connect();
      let plainTempPassword = null;
      let isNewAccount = false;
      let userId = null;
      let applicationApproved = false;

      try {
        await client.query('BEGIN');

        await client.query(
          `UPDATE referrals
           SET status               = 'approved',
               responsibility_level = $1,
               reviewed_by          = $2,
               reviewed_at          = NOW()
           WHERE id = $3`,
          [responsibilityLevel, adminId, referralId]
        );

        const existingUser = await client.query(
          `SELECT id FROM users WHERE LOWER(email) = LOWER($1)`,
          [referral.email]
        );

        if (existingUser.rows.length > 0) {
          userId = existingUser.rows[0].id;
          await client.query(
            `UPDATE users SET role = 'tutor' WHERE id = $1`,
            [userId]
          );
        } else {
          isNewAccount = true;
          plainTempPassword = generateTempPassword();
          const passwordHash = await bcrypt.hash(plainTempPassword, BCRYPT_COST);

          const userInsert = await client.query(
            `INSERT INTO users
               (first_names, surname, email, password_hash, role, temp_password_flag)
             VALUES ($1, $2, $3, $4, 'tutor', TRUE)
             RETURNING id`,
            [
              referral.first_names,
              referral.surname,
              referral.email,
              passwordHash,
            ]
          );
          userId = userInsert.rows[0].id;
        }

        const appResult = await client.query(
          `SELECT id, status FROM applications WHERE user_id = $1`,
          [userId]
        );

        if (appResult.rows.length > 0) {
          await client.query(
            `UPDATE applications
             SET status               = 'approved',
                 responsibility_level = $1,
                 assigned_lecturer_id = $2,
                 course               = $3,
                 module_code          = $4,
                 module_name          = $5,
                 qualification_level  = $6,
                 rejection_reason     = NULL,
                 reviewed_at          = NOW(),
                 submitted_at         = COALESCE(submitted_at, NOW())
             WHERE id = $7`,
            [
              responsibilityLevel,
              referral.lecturer_id,
              referral.course,
              referral.module_code,
              referral.module_name,
              referral.qualification_level,
              appResult.rows[0].id,
            ]
          );
          applicationApproved = true;
        } else {
          await client.query(
            `INSERT INTO applications
               (user_id, course, module_code, module_name, qualification_level,
                status, responsibility_level, assigned_lecturer_id,
                submitted_at, reviewed_at)
             VALUES ($1, $2, $3, $4, $5, 'approved', $6, $7, NOW(), NOW())`,
            [
              userId,
              referral.course,
              referral.module_code,
              referral.module_name,
              referral.qualification_level,
              responsibilityLevel,
              referral.lecturer_id,
            ]
          );
          applicationApproved = true;
        }

        await client.query(
          `INSERT INTO tutor_profiles (user_id, step1_complete, step2_complete)
           VALUES ($1, FALSE, FALSE)
           ON CONFLICT (user_id) DO NOTHING`,
          [userId]
        );

        await client.query('COMMIT');

      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      const loginLink = referralLoginLink();
      let emailSent = false;

      try {
        if (isNewAccount && plainTempPassword) {
          await sendReferralApprovalEmail({
            studentEmail:     referral.email,
            studentFirstName: referral.first_names,
            moduleCode:       referral.module_code,
            moduleName:       referral.module_name,
            tempPassword:     plainTempPassword,
            loginLink,
          });
        } else {
          await sendReferralApprovalNoPasswordEmail({
            studentEmail:     referral.email,
            studentFirstName: referral.first_names,
            moduleCode:       referral.module_code,
            moduleName:       referral.module_name,
            loginLink,
          });
        }
        emailSent = true;
        console.log(`Referral approval email sent to ${referral.email}`);
      } catch (err) {
        console.error(`Referral approval email failed (${referral.email}):`, err.message);
      }

      return res.status(200).json({
        message: 'Referral approved successfully.',
        email: referral.email,
        applicationApproved,
        accountCreated: isNewAccount,
        emailSent,
        // tempPassword intentionally omitted from response
        // Email failure does not expose credentials via API
      });

    } catch (err) {
      console.error('Approve referral error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);


router.patch(
  '/:id/reject',
  adminActionLimiter,
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    const referralId = parseInt(req.params.id);
    const { reason } = req.body;
    const adminId = req.user.userId;

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ errors: ['Rejection reason is required.'] });
    }

    try {
      const result = await pool.query(
        `UPDATE referrals
         SET status           = 'rejected',
             rejection_reason = $1,
             reviewed_by      = $2,
             reviewed_at      = NOW()
         WHERE id = $3 AND status = 'pending'
         RETURNING id`,
        [reason.trim(), adminId, referralId]
      );

      if (result.rows.length === 0) {
        return res.status(409).json({
          errors: ['Referral not found or not in a pending state.'],
        });
      }

      return res.status(200).json({ message: 'Referral rejected.' });

    } catch (err) {
      console.error('Reject referral error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);


module.exports = router;
