'use strict';

const router       = require('express').Router();
const pool         = require('../db');
const authenticate = require('../middleware/authenticate');
const requireRole  = require('../middleware/requireRole');
const { uploadLimiter } = require('../middleware/rateLimiter');
const { isApplicationsOpenFromDb } = require('./public');
const multer       = require('multer');
const path         = require('path');
const {
  findCurriculumModule,
  courseToProgramme,
  minYearLevelToQualEnum,
  meetsMinimumQualification,
} = require('../constants');
const {
  sendApplicationApprovedEmail,
  sendApplicationRejectedEmail,
} = require('../services/mailer');
const { screenApplication } = require('../services/documentScanner');
const { getSettings } = require('../services/settings');
const { uploadFile } = require('../services/storage');
const { validateUploadedFile } = require('../utils/fileValidation');
const { validateAcademicSave, validateSubmitApplication } = require('../validators/applicationValidator');

// =============================================================
//  MULTER — file upload config
//  Accepts CV and transcript PDFs only.
//  Files saved to backend/uploads/ as userId_fieldname_timestamp.pdf
// =============================================================

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../uploads'));
  },
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = `${req.user.userId}_${file.fieldname}_${Date.now()}${ext}`;
    cb(null, name);
  },
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Only PDF files are accepted.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max per file
});


// =============================================================
//  PATCH /api/applications/me/academic
//  Called when tutor clicks "Next" on apply-step2.html
//  Saves academic info onto the existing (incomplete) application.
//  Requires: tutor JWT
// =============================================================

router.patch(
  '/me/academic',
  authenticate,
  requireRole('tutor'),
  validateAcademicSave,
  async (req, res) => {
    const { faculty, course, qualificationLevel, moduleYearLevel, moduleName, moduleCode, gpa } = req.body;
    const userId = req.user.userId;

    if (!(await isApplicationsOpenFromDb())) {
      return res.status(403).json({ errors: ['Applications are currently closed.'] });
    }

    const gpaNum = parseFloat(gpa);
    if (isNaN(gpaNum) || gpaNum < 0 || gpaNum > 100) {
      return res.status(400).json({ errors: ['GPA must be a number between 0 and 100.'] });
    }

    const normalisedCode = String(moduleCode).trim().toUpperCase();

    const curriculumHit = findCurriculumModule(
      course,
      moduleYearLevel,
      moduleName.trim(),
      normalisedCode
    );

    if (!curriculumHit) {
      return res.status(400).json({
        errors: [`"${moduleName}" is not a valid module for ${course} — ${moduleYearLevel}.`],
      });
    }

    const savedCourse = curriculumHit.courseKey;
    const savedYear   = curriculumHit.yearKey;
    const savedName   = curriculumHit.mod.name;
    const savedCode   = curriculumHit.mod.code.toUpperCase();

    try {
      const dbModule = await pool.query(
        'SELECT code FROM modules WHERE code = $1',
        [savedCode]
      );
      if (dbModule.rows.length === 0) {
        return res.status(400).json({ errors: [`Module code "${savedCode}" is not in the curriculum registry.`] });
      }
      // Confirm the application exists and belongs to this tutor
      const appCheck = await pool.query(
        'SELECT id, status FROM applications WHERE user_id = $1',
        [userId]
      );
      if (appCheck.rows.length === 0) {
        return res.status(404).json({ errors: ['Application record not found.'] });
      }

      // Don't allow edits if already submitted
      if (!['incomplete'].includes(appCheck.rows[0].status)) {
        return res.status(409).json({
          errors: ['Application has already been submitted and cannot be edited.'],
        });
      }

      await pool.query(
        `UPDATE applications
         SET faculty             = $1,
             course              = $2,
             qualification_level = $3,
             module_year_level   = $4,
             module_name         = $5,
             module_code         = $6,
             gpa                 = $7
         WHERE user_id = $8`,
        [
          faculty.trim(),
          savedCourse,
          qualificationLevel,
          savedYear,
          savedName,
          savedCode,
          gpaNum,
          userId,
        ]
      );

      return res.status(200).json({ message: 'Academic info saved.' });

    } catch (err) {
      console.error('Academic save error:', err.message);
      return res.status(500).json({ errors: ['Server error. Please try again.'] });
    }
  }
);


// =============================================================
//  POST /api/applications/me/submit
//  Called when tutor clicks "Submit" on apply-step3.html
//  Accepts CV and transcript uploads, runs eligibility check,
//  sets application status to submitted or rejected.
//  Requires: tutor JWT
// =============================================================

router.post(
  '/me/submit',
  uploadLimiter,
  authenticate,
  requireRole('tutor'),
  upload.fields([
    { name: 'cvFile',         maxCount: 1 },
    { name: 'transcriptFile', maxCount: 1 },
  ]),
  validateSubmitApplication,
  async (req, res) => {
    const userId  = req.user.userId;
    const { declared } = req.body;

    if (!(await isApplicationsOpenFromDb())) {
      return res.status(403).json({ errors: ['Applications are currently closed.'] });
    }

    try {
      // ── Load the application to run eligibility ──────────
      const appResult = await pool.query(
        `SELECT id, status, qualification_level, module_year_level, module_name, gpa, course
         FROM applications
         WHERE user_id = $1`,
        [userId]
      );

      if (appResult.rows.length === 0) {
        return res.status(404).json({ errors: ['Application record not found.'] });
      }

      const app = appResult.rows[0];

      if (app.status !== 'incomplete') {
        return res.status(409).json({
          errors: ['Application has already been submitted.'],
        });
      }

      // ── Check academic info was saved in step 2 ──────────
      if (!app.qualification_level || !app.module_name || !app.gpa) {
        return res.status(400).json({
          errors: ['Academic information is incomplete. Please complete Step 2 first.'],
        });
      }

      // ── Rule 3: posting exists + qualification + declared average ──
      const programme = courseToProgramme(app.course);
      const postingResult = programme
        ? await pool.query(
            `SELECT id, min_year_level, min_average
             FROM postings
             WHERE programme = $1 AND module_name = $2
             LIMIT 1`,
            [programme, app.module_name]
          )
        : { rows: [] };

      let eligibilityPass = true;
      let rejectionReason = null;
      let rejectionDetail = null;
      let screening       = null;
      let cvKeywordScore  = null;

      if (postingResult.rows.length === 0) {
        eligibilityPass = false;
        rejectionReason = 'There is no tutor posting for the module you selected.';
        rejectionDetail = 'Please verify available positions on the job postings page or contact the FYE office.';
      } else {
        const posting = postingResult.rows[0];
        const requiredQual = minYearLevelToQualEnum(posting.min_year_level);

        if (!meetsMinimumQualification(app.qualification_level, requiredQual)) {
          eligibilityPass = false;
          rejectionReason = 'Your qualification level does not meet the minimum required for this posting.';
          rejectionDetail = `This position requires at least ${posting.min_year_level}.`;
        } else if (parseFloat(app.gpa) < parseFloat(posting.min_average)) {
          eligibilityPass = false;
          rejectionReason = `Your declared average of ${app.gpa}% is below the ${posting.min_average}% minimum for this posting.`;
        }
      }

      const cvFile = req.files['cvFile'][0];
      const transcriptFile = req.files['transcriptFile'][0];
      const cvPath = cvFile.path;
      const transcriptPath = transcriptFile.path;

      const cvValidation = await validateUploadedFile(cvFile, ['application/pdf']);
      if (!cvValidation.valid) {
        return res.status(400).json({ error: 'Invalid file type.' });
      }

      const transcriptValidation = await validateUploadedFile(transcriptFile, ['application/pdf']);
      if (!transcriptValidation.valid) {
        return res.status(400).json({ error: 'Invalid file type.' });
      }

      if (eligibilityPass) {
        try {
          const settings = await getSettings();
          const scanResult = await screenApplication({
            cvPath,
            transcriptPath,
            claimedAverage:  parseFloat(app.gpa),
            tutorModuleName: app.module_name,
            settings,
          });

          screening      = scanResult.screening;
          cvKeywordScore = scanResult.screening?.cv?.score ?? null;

          if (!scanResult.pass) {
            eligibilityPass = false;
            rejectionReason = scanResult.reason;
            rejectionDetail = scanResult.detail;
          }
        } catch (scanErr) {
          console.error('Document screening error:', scanErr.message);
          // Screening failed — do not auto-reject for technical failure
          // Let the application through with a note in screening_result
          screening = {
            error: true,
            note: 'Document screening could not be completed: ' + scanErr.message,
          };
          // Keep eligibilityPass as true — human coordinator reviews
        }
      }

      const cvBasename         = req.files['cvFile'][0].filename;
      const transcriptBasename = req.files['transcriptFile'][0].filename;
      const cvStoragePath         = 'applications/' + cvBasename;
      const transcriptStoragePath = 'applications/' + transcriptBasename;

      try {
        await uploadFile(cvPath, cvStoragePath, 'application/pdf');
        console.log('CV uploaded to Supabase Storage:', cvStoragePath);
      } catch (storageErr) {
        console.error('Storage upload failed:', storageErr.message);
        // Continue anyway — local file still saved as fallback
      }

      try {
        await uploadFile(transcriptPath, transcriptStoragePath, 'application/pdf');
        console.log('Transcript uploaded to Supabase Storage:', transcriptStoragePath);
      } catch (storageErr) {
        console.error('Storage upload failed:', storageErr.message);
        // Continue anyway — local file still saved as fallback
      }

      const newStatus        = eligibilityPass ? 'submitted' : 'rejected';
      const screeningPayload = screening
        ? { ...screening, rejectionDetail: rejectionDetail || null }
        : null;

      await pool.query(
        `UPDATE applications
         SET cv_filename         = $1,
             transcript_filename = $2,
             declared            = TRUE,
             status              = $3,
             rejection_reason    = $4,
             cv_keyword_score    = $5,
             screening_result    = $6,
             submitted_at        = NOW()
         WHERE user_id = $7`,
        [
          cvStoragePath,
          transcriptStoragePath,
          newStatus,
          rejectionReason,
          cvKeywordScore,
          screeningPayload ? JSON.stringify(screeningPayload) : null,
          userId,
        ]
      );

      if (!eligibilityPass) {
        return res.status(200).json({
          pass:   false,
          status: 'rejected',
          reason: rejectionReason,
          detail: rejectionDetail,
        });
      }

      return res.status(200).json({
        pass:    true,
        status:  'submitted',
        message: 'Application submitted successfully. You will be notified of the outcome.',
        cvScore: cvKeywordScore,
        screening,
      });

    } catch (err) {
      console.error('Submit error:', err.message);
      return res.status(500).json({ errors: ['Server error. Please try again.'] });
    }
  }
);


// =============================================================
//  GET /api/applications/me
//  Returns the current tutor's application status and details.
//  Used by tracker.html and dashboard.html.
//  Requires: tutor JWT
// =============================================================

router.get(
  '/me',
  authenticate,
  requireRole('tutor'),
  async (req, res) => {
    const userId = req.user.userId;

    try {
      const result = await pool.query(
        `SELECT
           a.id,
           a.status,
           a.faculty,
           a.course,
           a.qualification_level,
           a.module_year_level,
           a.module_name,
           COALESCE(a.module_code, lm.module_code) AS module_code,
           a.gpa,
           a.cv_filename,
           a.cv_keyword_score,
           a.screening_result,
           a.transcript_filename,
           a.declared,
           a.rejection_reason,
           a.responsibility_level,
           a.assigned_lecturer_id,
           a.submitted_at,
           a.reviewed_at,
           u.first_names,
           u.surname,
           u.title,
           u.initials,
           u.email,
           lec.first_names AS lecturer_first_names,
           lec.surname     AS lecturer_surname,
           lm.module_code AS lecturer_module_code,
           COALESCE(tp.step1_complete, FALSE) AS step1_complete,
           COALESCE(tp.step2_complete, FALSE) AS step2_complete,
           (COALESCE(tp.step1_complete, FALSE) AND COALESCE(tp.step2_complete, FALSE)) AS onboarding_complete
         FROM applications a
         JOIN users u ON u.id = a.user_id
         LEFT JOIN tutor_profiles tp ON tp.user_id = a.user_id
         LEFT JOIN users lec ON lec.id = a.assigned_lecturer_id
         LEFT JOIN lecturer_modules lm
           ON lm.course = a.course AND lm.module_name = a.module_name
         WHERE a.user_id = $1`,
        [userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Application not found.' });
      }

      return res.status(200).json(result.rows[0]);

    } catch (err) {
      console.error('Get application error:', err.message);
      return res.status(500).json({ error: 'Server error.' });
    }
  }
);


// =============================================================
//  GET /api/applications
//  Returns all applications. Admin only — admin is the sole
//  reviewer of tutor applications in this system. Lecturers do
//  not review applications; their role is limited to sessions,
//  attendance, and claims.
//  Requires: admin JWT
// =============================================================

router.get(
  '/',
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    const { status, module } = req.query;

    const includeIncomplete = req.query.includeIncomplete === 'true';

    try {
      let query = `
        SELECT
          a.id,
          a.status,
          a.faculty,
          a.course,
          a.qualification_level,
          a.module_year_level,
          a.module_name,
          COALESCE(a.module_code, lm.module_code) AS module_code,
          a.gpa,
          a.cv_filename,
          a.cv_keyword_score,
          a.screening_result,
          a.transcript_filename,
          a.rejection_reason,
          a.responsibility_level,
          a.assigned_lecturer_id,
          a.submitted_at,
          a.reviewed_at,
          a.created_at,
           u.first_names,
           u.surname,
           u.title,
           u.initials,
           u.email,
           u.cell,
           u.student_number,
          lec.first_names AS lecturer_first_names,
          lec.surname     AS lecturer_surname
        FROM applications a
        JOIN users u ON u.id = a.user_id
        LEFT JOIN users lec ON lec.id = a.assigned_lecturer_id
        LEFT JOIN lecturer_modules lm
          ON lm.course = a.course AND lm.module_name = a.module_name
        WHERE 1=1
      `;
      const params = [];
      if (!includeIncomplete) {
        query += ` AND a.status != 'incomplete'`;
      }
      if (status) { params.push(status); query += ` AND a.status = $${params.length}`; }
      if (module) { params.push(`%${module}%`); query += ` AND a.module_name ILIKE $${params.length}`; }
      query += ' ORDER BY COALESCE(a.submitted_at, a.created_at) DESC';

      const result = await pool.query(query, params);
      return res.status(200).json(result.rows);

    } catch (err) {
      console.error('Get applications error:', err.message);
      return res.status(500).json({ error: 'Server error.' });
    }
  }
);


// =============================================================
//  PATCH /api/applications/:id/under-review
//  Admin marks an application as under review (opens the pool
//  for this applicant). Optional intermediate step before
//  approve/reject — purely a status marker for the tracker UI.
//  Requires: admin JWT
// =============================================================

router.patch(
  '/:id/under-review',
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    const appId = parseInt(req.params.id);

    try {
      const result = await pool.query(
        `UPDATE applications
         SET status      = 'under_review',
             reviewed_at = NOW()
         WHERE id = $1 AND status = 'submitted'
         RETURNING id`,
        [appId]
      );

      if (result.rows.length === 0) {
        return res.status(409).json({
          errors: ['Application not found or not in a submitted state.'],
        });
      }

      return res.status(200).json({ message: 'Application marked as under review.' });

    } catch (err) {
      console.error('Under-review error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);


// =============================================================
//  PATCH /api/applications/:id/shortlist
//  Admin shortlists an application that is currently under review.
//  This is an admin-only action — there is no lecturer review step.
//  Requires: admin JWT
// =============================================================

router.patch(
  '/:id/shortlist',
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    const appId = parseInt(req.params.id);

    try {
      const result = await pool.query(
        `UPDATE applications
         SET status      = 'shortlisted',
             reviewed_at = NOW()
         WHERE id = $1 AND status IN ('submitted', 'under_review')
         RETURNING id`,
        [appId]
      );

      if (result.rows.length === 0) {
        return res.status(409).json({
          errors: ['Application not found, or not in a state that can be shortlisted.'],
        });
      }

      return res.status(200).json({ message: 'Application shortlisted.' });

    } catch (err) {
      console.error('Shortlist error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);


// =============================================================
//  PATCH /api/applications/:id/approve
//  Admin approves an application and sets responsibility level.
//  This is the final step — tutor can now onboard.
//  Requires: admin JWT
// =============================================================

router.patch(
  '/:id/approve',
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    const appId = parseInt(req.params.id);
    const { responsibilityLevel } = req.body;

    if (!['standard', 'senior', 'lead'].includes(responsibilityLevel)) {
      return res.status(400).json({
        errors: ['Responsibility level must be standard, senior, or lead.'],
      });
    }

    try {
      // Load the full application to validate qualification + find matching lecturer
      const appResult = await pool.query(
        `SELECT a.qualification_level, a.course, a.module_name,
                u.email, u.first_names
         FROM applications a
         JOIN users u ON u.id = a.user_id
         WHERE a.id = $1`,
        [appId]
      );
      if (appResult.rows.length === 0) {
        return res.status(404).json({ errors: ['Application not found.'] });
      }

      const app = appResult.rows[0];

      // Validate the responsibility level is valid for this tutor's qualification
      const { getRateEntry } = require('../constants');
      try {
        getRateEntry(app.qualification_level, responsibilityLevel);
      } catch (rateErr) {
        return res.status(400).json({ errors: [rateErr.message] });
      }

      // Auto-assign the lecturer who owns this course + module combination.
      // This is the core link: a tutor's module_name must match exactly one
      // lecturer_modules.module_name for the same course.
      const lecturerResult = await pool.query(
        `SELECT lecturer_id FROM lecturer_modules
         WHERE course = $1 AND module_name = $2
         LIMIT 1`,
        [app.course, app.module_name]
      );

      if (lecturerResult.rows.length === 0) {
        return res.status(409).json({
          errors: [
            `No lecturer is currently assigned to "${app.module_name}" in ${app.course}. ` +
            `Please assign a lecturer to this module in User Management before approving this tutor.`
          ],
        });
      }

      const assignedLecturerId = lecturerResult.rows[0].lecturer_id;

      await pool.query(
        `UPDATE applications
         SET status                = 'approved',
             responsibility_level  = $1,
             assigned_lecturer_id  = $2,
             reviewed_at           = NOW()
         WHERE id = $3`,
        [responsibilityLevel, assignedLecturerId, appId]
      );

      const userResult = await pool.query(
        `SELECT user_id FROM applications WHERE id = $1`,
        [appId]
      );
      if (userResult.rows.length > 0) {
        await pool.query(
          `INSERT INTO tutor_profiles (user_id, step1_complete, step2_complete)
           VALUES ($1, FALSE, FALSE)
           ON CONFLICT (user_id) DO NOTHING`,
          [userResult.rows[0].user_id]
        );
      }

      sendApplicationApprovedEmail({
        studentEmail:     app.email,
        studentFirstName: app.first_names,
        moduleName:       app.module_name,
      })
        .then(() => {
          console.log(`Application approval email sent to ${app.email}`);
        })
        .catch((err) => {
          console.error(`Application approval email failed (${app.email}):`, err.message);
        });

      return res.status(200).json({
        message: 'Application approved successfully.',
        assignedLecturerId,
      });

    } catch (err) {
      console.error('Approve error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);


// =============================================================
//  PATCH /api/applications/:id/reject
//  Admin rejects an application with a reason.
//  Requires: admin JWT
// =============================================================

router.patch(
  '/:id/reject',
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    const appId = parseInt(req.params.id);
    const { reason } = req.body;

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ errors: ['Rejection reason is required.'] });
    }

    try {
      const appResult = await pool.query(
        `SELECT a.module_name, u.email, u.first_names
         FROM applications a
         JOIN users u ON u.id = a.user_id
         WHERE a.id = $1`,
        [appId]
      );
      if (appResult.rows.length === 0) {
        return res.status(404).json({ errors: ['Application not found.'] });
      }
      const app = appResult.rows[0];

      await pool.query(
        `UPDATE applications
         SET status           = 'rejected',
             rejection_reason = $1,
             reviewed_at      = NOW()
         WHERE id = $2`,
        [reason.trim(), appId]
      );

      sendApplicationRejectedEmail({
        studentEmail:     app.email,
        studentFirstName: app.first_names,
        moduleName:       app.module_name,
        reason:           reason.trim(),
      })
        .then(() => {
          console.log(`Application rejection email sent to ${app.email}`);
        })
        .catch((err) => {
          console.error(`Application rejection email failed (${app.email}):`, err.message);
        });

      return res.status(200).json({ message: 'Application rejected.' });

    } catch (err) {
      console.error('Reject error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);


module.exports = router;