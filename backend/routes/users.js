'use strict';

const router       = require('express').Router();
const pool         = require('../db');
const bcrypt       = require('bcrypt');
const jwt          = require('jsonwebtoken');
const path         = require('path');
const multer       = require('multer');
const authenticate = require('../middleware/authenticate');
const requireRole  = require('../middleware/requireRole');
const {
  adminActionLimiter,
  passwordResetLimiter,
} = require('../middleware/rateLimiter');

const BCRYPT_COST = 12;
const { generateTempPassword } = require('../utils/tempPassword');
const { parsePagination, sendList } = require('../utils/pagination');
const { cacheGet, cacheSet } = require('../services/cache');
const {
  sendLecturerWelcomeEmail,
  sendPasswordResetEmail,
  referralLoginLink,
} = require('../services/mailer');
const { uploadFile } = require('../services/storage');
const {
  validateOnboardingStep1,
  validateOnboardingStep2,
  validateOnboardingDocuments,
  validateProfileUpdate,
  validateCreateLecturer,
  validateAddLecturerModule,
  validateResetPassword,
} = require('../validators/userValidator');
const { validateUploadedFile } = require('../utils/fileValidation');

async function purgeTutorAccount(client, tutorId) {
  const userResult = await client.query(
    `SELECT id, email FROM users WHERE id = $1 AND role = 'tutor'`,
    [tutorId]
  );
  if (!userResult.rows.length) return false;

  const email = userResult.rows[0].email;

  await client.query(
    `DELETE FROM claim_sessions
     WHERE claim_id IN (SELECT id FROM claims WHERE tutor_id = $1)`,
    [tutorId]
  );
  await client.query(`DELETE FROM claims WHERE tutor_id = $1`, [tutorId]);
  await client.query(`DELETE FROM session_tutors WHERE tutor_id = $1`, [tutorId]);
  await client.query(
    `DELETE FROM referrals r
     WHERE LOWER(r.email) = LOWER($1)
        OR EXISTS (
          SELECT 1 FROM applications a
          WHERE a.user_id = $2
            AND a.course = r.course
            AND a.module_name = r.module_name
        )`,
    [email, tutorId]
  );
  await client.query(`DELETE FROM support_ticket_replies WHERE author_id = $1`, [tutorId]);
  await client.query(`DELETE FROM support_tickets WHERE created_by_id = $1`, [tutorId]);

  const deleted = await client.query(
    `DELETE FROM users WHERE id = $1 AND role = 'tutor' RETURNING id`,
    [tutorId]
  );
  return deleted.rows.length > 0;
}

async function purgeLecturerAccount(client, lecturerId) {
  const userResult = await client.query(
    `SELECT id FROM users WHERE id = $1 AND role = 'lecturer'`,
    [lecturerId]
  );
  if (!userResult.rows.length) return false;

  await client.query(
    `DELETE FROM claim_sessions
     WHERE claim_id IN (SELECT id FROM claims WHERE lecturer_id = $1)`,
    [lecturerId]
  );
  await client.query(`DELETE FROM claims WHERE lecturer_id = $1`, [lecturerId]);
  await client.query(
    `DELETE FROM claim_sessions
     WHERE session_id IN (SELECT id FROM sessions WHERE lecturer_id = $1)`,
    [lecturerId]
  );
  await client.query(`DELETE FROM sessions WHERE lecturer_id = $1`, [lecturerId]);
  await client.query(`DELETE FROM referrals WHERE lecturer_id = $1`, [lecturerId]);
  await client.query(
    `UPDATE applications SET assigned_lecturer_id = NULL WHERE assigned_lecturer_id = $1`,
    [lecturerId]
  );
  await client.query(
    `UPDATE referrals SET reviewed_by = NULL WHERE reviewed_by = $1`,
    [lecturerId]
  );
  await client.query(`DELETE FROM support_ticket_replies WHERE author_id = $1`, [lecturerId]);
  await client.query(`DELETE FROM support_tickets WHERE created_by_id = $1`, [lecturerId]);

  const deleted = await client.query(
    `DELETE FROM users WHERE id = $1 AND role = 'lecturer' RETURNING id`,
    [lecturerId]
  );
  return deleted.rows.length > 0;
}

function signTutorToken(userId, applicationStatus, onboardingComplete, tempFlag = false, identity = {}) {
  return jwt.sign(
    {
      userId,
      role:              'tutor',
      email:             identity.email || null,
      first_names:       identity.first_names || null,
      surname:           identity.surname || null,
      applicationStatus,
      onboardingComplete,
      tempFlag,
    },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );
}

async function ensureTutorProfile(userId) {
  await pool.query(
    `INSERT INTO tutor_profiles (user_id, step1_complete, step2_complete)
     VALUES ($1, FALSE, FALSE)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

const onboardingStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../uploads'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `onboarding_${req.user.userId}_${file.fieldname}_${Date.now()}${ext}`);
  },
});

const onboardingFileFilter = (req, file, cb) => {
  const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only PDF or image files are accepted.'), false);
  }
};

const onboardingUpload = multer({
  storage: onboardingStorage,
  fileFilter: onboardingFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

function maybeMultipartOnboarding(req, res, next) {
  const ct = req.headers['content-type'] || '';
  if (ct.includes('multipart/form-data')) {
    return onboardingUpload.fields([
      { name: 'id_document', maxCount: 1 },
      { name: 'tax_proof', maxCount: 1 },
      { name: 'bank_proof', maxCount: 1 },
    ])(req, res, next);
  }
  return next();
}

async function applyOnboardingDocumentUploads(userId, files) {
  if (!files) return null;
  const updates = [];
  const values = [];
  let idx = 1;

  const docs = [
    { field: 'id_document', column: 'id_document_filename' },
    { field: 'tax_proof', column: 'tax_proof_filename' },
    { field: 'bank_proof', column: 'bank_proof_filename' },
  ];

  for (const { field, column } of docs) {
    const file = files[field]?.[0];
    if (!file) continue;

    const storagePath = 'onboarding/' + file.filename;
    try {
      await uploadFile(file.path, storagePath, file.mimetype || 'application/octet-stream');
      console.log(`${field} uploaded to Supabase Storage:`, storagePath);
    } catch (storageErr) {
      console.error('Storage upload failed:', storageErr.message);
      // Continue anyway — local file still saved as fallback
    }

    updates.push(`${column} = $${idx++}`);
    values.push(storagePath);
  }

  if (!updates.length) return null;

  values.push(userId);
  await pool.query(
    `UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx}`,
    values
  );

  const result = await pool.query(
    `SELECT id_document_filename, tax_proof_filename, bank_proof_filename
     FROM users WHERE id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

// =============================================================
//  GET /api/users/me/tutor-profile
//  Returns onboarding progress + saved fields for the logged-in tutor.
// =============================================================

router.get(
  '/me/tutor-profile',
  authenticate,
  requireRole('tutor'),
  async (req, res) => {
    try {
      await ensureTutorProfile(req.user.userId);
      const result = await pool.query(
        `SELECT tp.id_number, tp.street_address, tp.city, tp.postal_code,
                tp.bank_name, tp.branch_code, tp.account_type, tp.account_number,
                tp.account_holder, tp.tax_number,
                tp.step1_complete, tp.step2_complete,
                u.residential_street, u.residential_city, u.residential_postal_code,
                u.residential_same_as_postal,
                u.id_document_filename, u.tax_proof_filename, u.bank_proof_filename
         FROM tutor_profiles tp
         JOIN users u ON u.id = tp.user_id
         WHERE tp.user_id = $1`,
        [req.user.userId]
      );
      if (result.rows.length === 0) {
        return res.status(200).json({ step1_complete: false, step2_complete: false });
      }
      return res.status(200).json(result.rows[0]);
    } catch (err) {
      console.error('Get tutor profile error:', err.message);
      return res.status(500).json({ error: 'Server error.' });
    }
  }
);

// =============================================================
//  PATCH /api/users/me/onboarding/step1
//  Saves personal/address details and marks step 1 complete.
// =============================================================

router.patch(
  '/me/onboarding/step1',
  authenticate,
  requireRole('tutor'),
  validateOnboardingStep1,
  async (req, res) => {
    const userId = req.user.userId;
    const {
      idNumber,
      postal,
      residentialSameAsPostal,
      residentialStreet,
      residentialCity,
      residentialPostalCode,
    } = req.body;

    const id = String(idNumber || '').replace(/\s/g, '');
    const sameAsPostal = residentialSameAsPostal === true
      || residentialSameAsPostal === 'true';

    let resStreet = '';
    let resCity = '';
    let resCode = '';

    if (sameAsPostal) {
      resStreet = postal.street.trim();
      resCity = postal.city.trim();
      resCode = String(postal.code).trim();
    } else {
      resStreet = String(residentialStreet || '').trim();
      resCity = String(residentialCity || '').trim();
      resCode = String(residentialPostalCode || '').trim();
    }

    try {
      const appCheck = await pool.query(
        `SELECT status FROM applications WHERE user_id = $1`,
        [userId]
      );
      if (appCheck.rows.length === 0 || appCheck.rows[0].status !== 'approved') {
        return res.status(403).json({ errors: ['Onboarding is only available for approved tutors.'] });
      }

      await ensureTutorProfile(userId);
      await pool.query(
        `UPDATE tutor_profiles
         SET id_number      = $1,
             street_address = $2,
             city           = $3,
             postal_code    = $4,
             step1_complete = TRUE,
             updated_at     = NOW()
         WHERE user_id = $5`,
        [
          id,
          postal.street.trim(),
          postal.city.trim(),
          String(postal.code).trim(),
          userId,
        ]
      );

      await pool.query(
        `UPDATE users
         SET residential_street = $1,
             residential_city = $2,
             residential_postal_code = $3,
             residential_same_as_postal = $4,
             updated_at = NOW()
         WHERE id = $5`,
        [resStreet, resCity, resCode, sameAsPostal, userId]
      );

      return res.status(200).json({ message: 'Step 1 saved.', step1_complete: true });
    } catch (err) {
      console.error('Onboarding step1 error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);

// =============================================================
//  PATCH /api/users/me/onboarding/step2
//  Saves banking/tax details, marks onboarding complete, returns fresh JWT.
// =============================================================

router.patch(
  '/me/onboarding/step2',
  authenticate,
  requireRole('tutor'),
  maybeMultipartOnboarding,
  validateOnboardingStep2,
  async (req, res) => {
    const userId = req.user.userId;
    const { bank, branch, acctype, accnum, accholder, taxnum } = req.body;

    try {
      const appCheck = await pool.query(
        `SELECT status FROM applications WHERE user_id = $1`,
        [userId]
      );
      if (appCheck.rows.length === 0 || appCheck.rows[0].status !== 'approved') {
        return res.status(403).json({ errors: ['Onboarding is only available for approved tutors.'] });
      }

      await ensureTutorProfile(userId);

      const step1 = await pool.query(
        `SELECT step1_complete FROM tutor_profiles WHERE user_id = $1`,
        [userId]
      );
      if (!step1.rows.length || !step1.rows[0].step1_complete) {
        return res.status(400).json({ errors: ['Please complete step 1 before submitting banking details.'] });
      }

      await pool.query(
        `UPDATE tutor_profiles
         SET bank_name       = $1,
             branch_code     = $2,
             account_type    = $3,
             account_number  = $4,
             account_holder  = $5,
             tax_number      = $6,
             step2_complete  = TRUE,
             updated_at      = NOW()
         WHERE user_id = $7`,
        [
          bank.trim(),
          String(branch).trim(),
          acctype.trim(),
          String(accnum).trim(),
          accholder.trim(),
          String(taxnum).replace(/\s/g, ''),
          userId,
        ]
      );

      let documents = null;
      try {
        documents = await applyOnboardingDocumentUploads(userId, req.files);
      } catch (docErr) {
        // Profile is already complete — don't block unlock if optional docs fail
        console.error('Onboarding step2 document upload error:', docErr.message);
      }

      const userRow = await pool.query(
        'SELECT email, first_names, surname FROM users WHERE id = $1',
        [userId]
      );
      const identity = userRow.rows[0] || {};

      const token = signTutorToken(
        userId,
        'approved',
        true,
        !!req.user.tempFlag,
        identity
      );

      return res.status(200).json({
        message:             'Profile complete. Your tutor dashboard is now unlocked.',
        token,
        onboardingComplete:  true,
        applicationStatus:   'approved',
        documents,
      });
    } catch (err) {
      console.error('Onboarding step2 error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);

// =============================================================
//  POST /api/users/me/onboarding/documents
//  Upload onboarding documents (optional; partial updates allowed).
// =============================================================

router.post(
  '/me/onboarding/documents',
  authenticate,
  requireRole('tutor'),
  onboardingUpload.fields([
    { name: 'id_document', maxCount: 1 },
    { name: 'tax_proof', maxCount: 1 },
    { name: 'bank_proof', maxCount: 1 },
  ]),
  validateOnboardingDocuments,
  async (req, res) => {
    const userId = req.user.userId;

    try {
      const files = req.files || {};
      const allowedMimeTypes = ['application/pdf', 'image/jpeg', 'image/png'];
      const fileFields = ['id_document', 'tax_proof', 'bank_proof'];

      for (const field of fileFields) {
        const file = files[field]?.[0];
        if (!file) continue;
        const validation = await validateUploadedFile(file, allowedMimeTypes);
        if (!validation.valid) {
          return res.status(400).json({ error: 'Invalid file type.' });
        }
      }

      const documents = await applyOnboardingDocumentUploads(userId, req.files);
      if (!documents) {
        return res.status(400).json({ errors: ['No files uploaded.'] });
      }
      return res.status(200).json(documents);
    } catch (err) {
      console.error('Onboarding documents error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);

// =============================================================
//  GET /api/users/me
//  Returns the logged-in user's profile (name, email, role).
// =============================================================

router.get(
  '/me',
  authenticate,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, first_names, surname, email, cell, student_number, role, title, initials,
                residential_street, residential_city, residential_postal_code,
                residential_same_as_postal,
                id_document_filename, tax_proof_filename, bank_proof_filename
         FROM users WHERE id = $1`,
        [req.user.userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'User not found.' });
      }

      return res.status(200).json(result.rows[0]);
    } catch (err) {
      console.error('Get me error:', err.message);
      return res.status(500).json({ error: 'Server error.' });
    }
  }
);

// =============================================================
//  GET /api/users/me/modules
//  Returns the logged-in lecturer's own assigned modules.
//  Used by the lecturer dashboard's module switcher and the
//  New Session modal's module label.
//  Requires: lecturer JWT
// =============================================================

router.get(
  '/me/modules',
  authenticate,
  requireRole('lecturer', 'tutor'),
  async (req, res) => {
    try {
      if (req.user.role === 'lecturer') {
        const result = await pool.query(
          `SELECT module_code, module_name, course
           FROM lecturer_modules
           WHERE lecturer_id = $1
           ORDER BY module_code ASC`,
          [req.user.userId]
        );

        return res.status(200).json(
          result.rows.map(r => ({
            code:   r.module_code,
            name:   r.module_name,
            course: r.course,
          }))
        );
      }

      const result = await pool.query(
        `SELECT lm.module_code, lm.module_name, lm.course
         FROM applications a
         JOIN lecturer_modules lm
           ON (
             lm.module_name = a.module_name
             OR (a.module_code IS NOT NULL AND lm.module_code = a.module_code)
           )
          AND (
            lm.course = a.course
            OR TRIM(REPLACE(lm.course, '—', '-')) = TRIM(REPLACE(a.course, '—', '-'))
          )
         WHERE a.user_id = $1 AND a.status = 'approved'
         ORDER BY lm.module_code ASC`,
        [req.user.userId]
      );

      if (result.rows.length > 0) {
        return res.status(200).json(
          result.rows.map(r => ({
            code:   r.module_code,
            name:   r.module_name,
            course: r.course,
          }))
        );
      }

      const appResult = await pool.query(
        `SELECT module_code, module_name, course
         FROM applications
         WHERE user_id = $1 AND status = 'approved'`,
        [req.user.userId]
      );

      if (appResult.rows.length > 0) {
        const a = appResult.rows[0];
        const byName = await pool.query(
          `SELECT module_code, module_name, course
           FROM lecturer_modules
           WHERE module_name = $1
           LIMIT 1`,
          [a.module_name]
        );
        if (byName.rows.length > 0) {
          const lm = byName.rows[0];
          return res.status(200).json([{
            code:   lm.module_code,
            name:   lm.module_name,
            course: lm.course,
          }]);
        }
        const code = a.module_code || (a.module_name || '').split(/\s+/)[0] || 'MODULE';
        return res.status(200).json([{
          code,
          name:   a.module_name || code,
          course: a.course || '',
        }]);
      }

      return res.status(200).json([]);

    } catch (err) {
      console.error('Get own modules error:', err.message);
      return res.status(500).json({ error: 'Server error.' });
    }
  }
);

// =============================================================
//  PATCH /api/users/me/profile
//  Tutor updates student number and cell phone.
// =============================================================

router.patch(
  '/me/profile',
  authenticate,
  requireRole('tutor'),
  validateProfileUpdate,
  async (req, res) => {
    const { studentNumber, cellPhone } = req.body;
    const userId = req.user.userId;

    try {
      const updates = [];
      const values = [];
      let idx = 1;

      if (studentNumber !== undefined) {
        updates.push(`student_number = $${idx}`);
        values.push(studentNumber ? String(studentNumber).trim() : null);
        idx += 1;
      }
      if (cellPhone !== undefined) {
        updates.push(`cell = $${idx}`);
        values.push(cellPhone ? String(cellPhone).trim() : null);
        idx += 1;
      }

      if (!updates.length) {
        return res.status(400).json({ errors: ['No valid fields provided.'] });
      }

      updates.push('updated_at = NOW()');
      values.push(userId);

      const result = await pool.query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}
         RETURNING id, first_names, surname, email, cell, student_number, role, title, initials,
                   residential_street, residential_city, residential_postal_code,
                   residential_same_as_postal,
                   id_document_filename, tax_proof_filename, bank_proof_filename`,
        values
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ errors: ['User not found.'] });
      }

      return res.status(200).json(result.rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ errors: ['This student number is already in use.'] });
      }
      console.error('Patch profile error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);

// =============================================================
//  POST /api/users/lecturer
//  Admin creates a lecturer account.
//  Generates a temp password shown once in the response.
//  Lecturer is forced to reset on first login (tempFlag = true).
//  Requires: admin JWT
// =============================================================

router.post(
  '/lecturer',
  adminActionLimiter,
  authenticate,
  requireRole('admin'),
  validateCreateLecturer,
  async (req, res) => {
    const { firstName, surname, email, cell, modules } = req.body;
    // modules: array of { code, name } e.g. [{ code: 'IS211', name: 'Information Systems 211' }]

    try {
      // ── Check for duplicate email ────────────────────────
      const existing = await pool.query(
        'SELECT id FROM users WHERE email = $1',
        [email.toLowerCase().trim()]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({
          errors: ['An account with this email address already exists.'],
        });
      }

      // ── Generate and hash temp password ──────────────────
      const tempPassword = generateTempPassword();
      const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_COST);

      // ── Insert user + modules in one transaction ─────────
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const userResult = await client.query(
          `INSERT INTO users
             (first_names, surname, email, cell, password_hash, role, temp_password_flag)
           VALUES ($1, $2, $3, $4, $5, 'lecturer', TRUE)
           RETURNING id`,
          [
            firstName.trim(),
            surname.trim(),
            email.toLowerCase().trim(),
            cell ? cell.trim() : null,
            passwordHash,
          ]
        );

        const lecturerId = userResult.rows[0].id;

        // Insert each assigned module
        for (const mod of modules) {
          if (!mod.code || !mod.name || !mod.course) continue;
          await client.query(
            `INSERT INTO lecturer_modules (lecturer_id, course, module_code, module_name)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (course, module_name) DO NOTHING`,
            [lecturerId, mod.course.trim(), mod.code.trim().toUpperCase(), mod.name.trim()]
          );
        }

        await client.query('COMMIT');

        const lecturerEmail = email.toLowerCase().trim();
        const loginLink = referralLoginLink();

        let emailSent = false;
        try {
          await sendLecturerWelcomeEmail({
            lecturerEmail,
            lecturerFirstName: firstName.trim(),
            tempPassword,
            modules,
            loginLink,
          });
          emailSent = true;
          console.log(`Lecturer welcome email sent to ${lecturerEmail}`);
        } catch (err) {
          console.error(`Lecturer welcome email failed (${lecturerEmail}):`, err.message);
        }

        return res.status(201).json({
          message:    'Lecturer account created successfully.',
          lecturerId,
          email:      lecturerEmail,
          emailSent,
          tempPassword,
        });

      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

    } catch (err) {
      console.error('Create lecturer error:', err.message);
      return res.status(500).json({ errors: ['Server error. Please try again.'] });
    }
  }
);


// =============================================================
//  GET /api/users/lecturers
//  Returns all lecturer accounts with their assigned modules.
//  Used by admin dashboard to manage lecturers.
//  Requires: admin JWT
// =============================================================

router.get(
  '/lecturers',
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
           u.id,
           u.first_names,
           u.surname,
           u.email,
           u.cell,
           u.temp_password_flag,
           u.created_at,
           COALESCE(
             JSON_AGG(
               JSON_BUILD_OBJECT('code', lm.module_code, 'name', lm.module_name, 'course', lm.course)
             ) FILTER (WHERE lm.id IS NOT NULL),
             '[]'
           ) AS modules
         FROM users u
         LEFT JOIN lecturer_modules lm ON lm.lecturer_id = u.id
         WHERE u.role = 'lecturer'
         GROUP BY u.id
         ORDER BY u.surname ASC`
      );

      return res.status(200).json(result.rows);

    } catch (err) {
      console.error('Get lecturers error:', err.message);
      return res.status(500).json({ error: 'Server error.' });
    }
  }
);


// =============================================================
//  GET /api/users/tutors
//  Returns approved tutors.
//  Admin sees all. Lecturer sees only tutors assigned to them
//  via assigned_lecturer_id (set at approval time).
//  Requires: admin or lecturer JWT
// =============================================================

router.get(
  '/tutors',
  authenticate,
  requireRole('admin', 'lecturer'),
  async (req, res) => {
    const { userId, role } = req.user;
    const moduleCode = req.query.moduleCode
      ? String(req.query.moduleCode).trim().toUpperCase()
      : null;
    const pagination = parsePagination(req.query);
    const cacheKey = `tutors:${role}:${userId}:${moduleCode || '*'}:${pagination.enabled ? `${pagination.page}:${pagination.limit}` : 'all'}`;

    try {
      const cached = cacheGet(cacheKey);
      if (cached !== undefined) {
        return sendList(res, cached.rows, pagination, cached.total);
      }

      let query = `
        SELECT
           u.id,
           u.first_names,
           u.surname,
           u.email,
           u.cell,
           u.student_number,
           a.qualification_level,
           a.module_name,
           a.responsibility_level,
           a.assigned_lecturer_id,
           a.gpa,
           lec.first_names AS lecturer_first_names,
           lec.surname     AS lecturer_surname,
           tp.step1_complete,
           tp.step2_complete
         FROM users u
         JOIN applications a ON a.user_id = u.id
         LEFT JOIN users lec ON lec.id = a.assigned_lecturer_id
         LEFT JOIN tutor_profiles tp ON tp.user_id = u.id
         WHERE u.role = 'tutor'
           AND a.status = 'approved'`;

      const params = [];
      if (role === 'lecturer') {
        params.push(userId);
        query += ` AND a.assigned_lecturer_id = $${params.length}`;

        if (moduleCode) {
          params.push(moduleCode);
          query += `
            AND EXISTS (
              SELECT 1 FROM lecturer_modules lm
              WHERE lm.lecturer_id = $1
                AND UPPER(lm.module_code) = $${params.length}
                AND (
                  lm.module_name = a.module_name
                  OR (a.module_code IS NOT NULL AND UPPER(lm.module_code) = UPPER(a.module_code))
                )
            )`;
        }
      }

      const countResult = await pool.query(
        `SELECT COUNT(*)::int AS total FROM (${query}) AS tutors_count`,
        params
      );
      const total = countResult.rows[0]?.total || 0;

      query += ' ORDER BY u.surname ASC';
      if (pagination.enabled) {
        params.push(pagination.limit, pagination.offset);
        query += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
      }

      const result = await pool.query(query, params);
      cacheSet(cacheKey, { rows: result.rows, total });
      return sendList(res, result.rows, pagination, total);

    } catch (err) {
      console.error('Get tutors error:', err.message);
      return res.status(500).json({ error: 'Server error.' });
    }
  }
);


// =============================================================
//  DELETE /api/users/lecturer/:id
//  Admin removes a lecturer account.
//  Cascades to lecturer_modules (ON DELETE CASCADE in schema).
//  Requires: admin JWT
// =============================================================

router.delete(
  '/lecturer/:id',
  adminActionLimiter,
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    const lecturerId = parseInt(req.params.id);

    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const removed = await purgeLecturerAccount(client, lecturerId);
        if (!removed) {
          await client.query('ROLLBACK');
          return res.status(404).json({ errors: ['Lecturer not found.'] });
        }
        await client.query('COMMIT');
        return res.status(200).json({ message: 'Lecturer account deleted.' });
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

    } catch (err) {
      console.error('Delete lecturer error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);


// =============================================================
//  DELETE /api/users/tutor/:id
//  Admin removes a tutor account.
//  Cascades to applications, tutor_profiles, session_tutors,
//  claims, etc. via ON DELETE CASCADE in schema.
//  Requires: admin JWT
// =============================================================

router.delete(
  '/tutor/:id',
  adminActionLimiter,
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    const tutorId = parseInt(req.params.id);

    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const removed = await purgeTutorAccount(client, tutorId);
        if (!removed) {
          await client.query('ROLLBACK');
          return res.status(404).json({ errors: ['Tutor not found.'] });
        }
        await client.query('COMMIT');
        return res.status(200).json({ message: 'Tutor account deleted.' });
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

    } catch (err) {
      console.error('Delete tutor error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);


// =============================================================
//  PATCH /api/users/:role/:id/reset-password
//  Admin resets a lecturer's or tutor's password.
//  Generates a new temp password, shown once in the response.
//  Sets temp_password_flag = TRUE so the user must reset on
//  their next login, same flow as a newly created lecturer.
//  Requires: admin JWT
// =============================================================

router.patch(
  '/:role/:id/reset-password',
  passwordResetLimiter,
  authenticate,
  requireRole('admin'),
  validateResetPassword,
  async (req, res) => {
    const { role, id } = req.params;
    const userId = parseInt(id);

    try {
      const tempPassword = generateTempPassword();
      const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_COST);

      const result = await pool.query(
        `UPDATE users
         SET password_hash      = $1,
             temp_password_flag = TRUE
         WHERE id = $2 AND role = $3
         RETURNING id, email, first_names, role`,
        [passwordHash, userId, role]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ errors: [`${role} not found.`] });
      }

      const user = result.rows[0];
      const loginLink = referralLoginLink();

      let emailSent = false;
      try {
        await sendPasswordResetEmail({
          userEmail:     user.email,
          userFirstName: user.first_names,
          tempPassword,
          loginLink,
          role: user.role,
        });
        emailSent = true;
        console.log(`Password reset email sent to ${user.email}`);
      } catch (err) {
        console.error(`Password reset email failed (${user.email}):`, err.message);
      }

      return res.status(200).json({
        message: 'Password reset successfully.',
        email:   user.email,
        emailSent,
        tempPassword,
      });

    } catch (err) {
      console.error('Reset password error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);


// =============================================================
//  POST /api/users/lecturer/:id/modules
//  Admin adds a module to a lecturer's assignment list.
//  A lecturer can have any number of modules.
//  Requires: admin JWT
// =============================================================

router.post(
  '/lecturer/:id/modules',
  adminActionLimiter,
  authenticate,
  requireRole('admin'),
  validateAddLecturerModule,
  async (req, res) => {
    const lecturerId = parseInt(req.params.id);
    const { code, name, course } = req.body;

    try {
      const lecturerCheck = await pool.query(
        `SELECT id FROM users WHERE id = $1 AND role = 'lecturer'`,
        [lecturerId]
      );
      if (lecturerCheck.rows.length === 0) {
        return res.status(404).json({ errors: ['Lecturer not found.'] });
      }

      await pool.query(
        `INSERT INTO lecturer_modules (lecturer_id, course, module_code, module_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (course, module_name) DO NOTHING`,
        [lecturerId, course.trim(), code.trim().toUpperCase(), name.trim()]
      );

      return res.status(201).json({ message: 'Module added.' });

    } catch (err) {
      console.error('Add module error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);


// =============================================================
//  DELETE /api/users/lecturer/:id/modules/:moduleCode
//  Admin removes a module from a lecturer's assignment list.
//  Requires: admin JWT
// =============================================================

router.delete(
  '/lecturer/:id/modules/:moduleCode',
  adminActionLimiter,
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    const lecturerId = parseInt(req.params.id);
    const moduleCode = req.params.moduleCode.toUpperCase();
    const course     = req.query.course;

    try {
      // If course provided, use the (course, module_code) pair for identification
      // which is more precise after migration 003.
      const query = course
        ? `DELETE FROM lecturer_modules
           WHERE lecturer_id = $1 AND module_code = $2 AND course = $3
           RETURNING id`
        : `DELETE FROM lecturer_modules
           WHERE lecturer_id = $1 AND module_code = $2
           RETURNING id`;

      const params = course ? [lecturerId, moduleCode, course] : [lecturerId, moduleCode];
      const result = await pool.query(query, params);

      if (result.rows.length === 0) {
        return res.status(404).json({ errors: ['Module assignment not found.'] });
      }

      return res.status(200).json({ message: 'Module removed.' });

    } catch (err) {
      console.error('Remove module error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);


module.exports = router;