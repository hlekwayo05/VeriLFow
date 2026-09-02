'use strict';

const router       = require('express').Router();
const pool         = require('../db');
const authenticate = require('../middleware/authenticate');
const requireRole  = require('../middleware/requireRole');
const { uploadLimiter } = require('../middleware/rateLimiter');
const { isApplicationsOpenFromDb } = require('./public');
const multer       = require('multer');
const path         = require('path');
const fs           = require('fs');
const os           = require('os');
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


const UPLOAD_TMP_DIR = path.join(os.tmpdir(), 'veriflow-uploads');
fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_TMP_DIR);
  },
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = `${req.user.userId}_${file.fieldname}_${Date.now()}${ext}`;
    cb(null, name);
  },
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();
  // Mobile browsers often send application/octet-stream for PDFs
  if (mime === 'application/pdf' || ext === '.pdf') {
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

function multerFields(fields) {
  const run = upload.fields(fields);
  return (req, res, next) => {
    run(req, res, (err) => {
      if (!err) return next();
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'Each PDF must be under 5MB.'
        : (err.message || 'File upload failed.');
      return res.status(400).json({ errors: [msg] });
    });
  };
}

async function persistUploadToStorage(localPath, storagePath) {
  try {
    await uploadFile(localPath, storagePath, 'application/pdf');
    console.log('Uploaded to Supabase Storage:', storagePath);
    return storagePath;
  } catch (storageErr) {
    console.error('Storage upload failed:', storageErr.message);
    // Keep local basename as fallback path the files route can serve
    return 'applications/' + path.basename(localPath);
  }
}

function safeOriginalFilename(originalname) {
  const base = path.basename(String(originalname || '').trim());
  return base ? base.slice(0, 255) : null;
}


router.post(
  '/me/documents',
  authenticate,
  requireRole('tutor'),
  multerFields([
    { name: 'cvFile',         maxCount: 1 },
    { name: 'transcriptFile', maxCount: 1 },
  ]),
  async (req, res) => {
    const userId = req.user.userId;

    if (!(await isApplicationsOpenFromDb())) {
      return res.status(403).json({ errors: ['Applications are currently closed.'] });
    }

    const hasCv = !!(req.files && req.files.cvFile && req.files.cvFile[0]);
    const hasTranscript = !!(req.files && req.files.transcriptFile && req.files.transcriptFile[0]);
    if (!hasCv && !hasTranscript) {
      return res.status(400).json({ errors: ['Please choose a PDF to upload.'] });
    }

    try {
      const appResult = await pool.query(
        `SELECT id, status, cv_filename, transcript_filename,
                cv_original_name, transcript_original_name
         FROM applications WHERE user_id = $1`,
        [userId]
      );
      if (appResult.rows.length === 0) {
        return res.status(404).json({ errors: ['Application record not found.'] });
      }
      const app = appResult.rows[0];
      if (app.status !== 'incomplete') {
        return res.status(409).json({ errors: ['Application has already been submitted.'] });
      }

      let cvStoragePath = app.cv_filename || null;
      let transcriptStoragePath = app.transcript_filename || null;
      let cvOriginalName = app.cv_original_name || null;
      let transcriptOriginalName = app.transcript_original_name || null;

      if (hasCv) {
        const file = req.files.cvFile[0];
        cvStoragePath = await persistUploadToStorage(
          file.path,
          'applications/' + file.filename
        );
        cvOriginalName = safeOriginalFilename(file.originalname);
      }
      if (hasTranscript) {
        const file = req.files.transcriptFile[0];
        transcriptStoragePath = await persistUploadToStorage(
          file.path,
          'applications/' + file.filename
        );
        transcriptOriginalName = safeOriginalFilename(file.originalname);
      }

      await pool.query(
        `UPDATE applications
         SET cv_filename = COALESCE($1, cv_filename),
             transcript_filename = COALESCE($2, transcript_filename),
             cv_original_name = COALESCE($3, cv_original_name),
             transcript_original_name = COALESCE($4, transcript_original_name)
         WHERE user_id = $5 AND status = 'incomplete'`,
        [cvStoragePath, transcriptStoragePath, cvOriginalName, transcriptOriginalName, userId]
      );

      return res.json({
        cv: !!cvStoragePath,
        transcript: !!transcriptStoragePath,
        cv_filename: cvStoragePath,
        transcript_filename: transcriptStoragePath,
        cv_original_name: cvOriginalName,
        transcript_original_name: transcriptOriginalName,
      });
    } catch (err) {
      console.error('Draft document upload error:', err.message);
      return res.status(500).json({ errors: ['Could not save document. Please try again.'] });
    }
  }
);


router.patch(
  '/me/academic',
  authenticate,
  requireRole('tutor'),
  validateAcademicSave,
  async (req, res) => {
    const { faculty, course, qualificationLevel, moduleYearLevel, moduleName, moduleCode, gpa, positionType } = req.body;
    const userId = req.user.userId;

    if (!(await isApplicationsOpenFromDb())) {
      return res.status(403).json({ errors: ['Applications are currently closed.'] });
    }

    if (!['tutor', 'demonstrator'].includes(positionType)) {
      return res.status(400).json({ errors: ['Position type must be tutor or demonstrator.'] });
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
             gpa                 = $7,
             position_type       = $8
         WHERE user_id = $9`,
        [
          faculty.trim(),
          savedCourse,
          qualificationLevel,
          savedYear,
          savedName,
          savedCode,
          gpaNum,
          positionType,
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


router.post(
  '/me/submit',
  uploadLimiter,
  authenticate,
  requireRole('tutor'),
  multerFields([
    { name: 'cvFile',         maxCount: 1 },
    { name: 'transcriptFile', maxCount: 1 },
  ]),
  validateSubmitApplication,
  async (req, res) => {
    const userId  = req.user.userId;
    const { declared } = req.body;
    const fs = require('fs');

    if (!(await isApplicationsOpenFromDb())) {
      return res.status(403).json({ errors: ['Applications are currently closed.'] });
    }

    try {
      const appResult = await pool.query(
        `SELECT id, status, qualification_level, module_year_level, module_name, gpa, course,
                cv_filename, transcript_filename, cv_original_name, transcript_original_name,
                position_type
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

      if (!app.qualification_level || !app.module_name || !app.gpa) {
        return res.status(400).json({
          errors: ['Academic information is incomplete. Please complete Step 2 first.'],
        });
      }

      const uploadsDir = path.join(__dirname, '../uploads');
      const freshCv = req.files && req.files.cvFile && req.files.cvFile[0];
      const freshTranscript = req.files && req.files.transcriptFile && req.files.transcriptFile[0];

      let cvPath;
      let transcriptPath;
      let cvStoragePath;
      let transcriptStoragePath;

      let cvOriginalName = app.cv_original_name || null;
      let transcriptOriginalName = app.transcript_original_name || null;

      if (freshCv) {
        cvPath = freshCv.path;
        cvStoragePath = await persistUploadToStorage(cvPath, 'applications/' + freshCv.filename);
        cvOriginalName = safeOriginalFilename(freshCv.originalname);
      } else if (app.cv_filename) {
        cvStoragePath = app.cv_filename;
        cvPath = path.join(uploadsDir, path.basename(app.cv_filename));
      }

      if (freshTranscript) {
        transcriptPath = freshTranscript.path;
        transcriptStoragePath = await persistUploadToStorage(
          transcriptPath,
          'applications/' + freshTranscript.filename
        );
        transcriptOriginalName = safeOriginalFilename(freshTranscript.originalname);
      } else if (app.transcript_filename) {
        transcriptStoragePath = app.transcript_filename;
        transcriptPath = path.join(uploadsDir, path.basename(app.transcript_filename));
      }

      const errors = [];
      if (!cvPath) errors.push('CV (PDF) is required.');
      if (!transcriptPath) errors.push('Academic transcript (PDF) is required.');
      if (!declared || declared !== 'true') {
        errors.push('You must accept the declaration before submitting.');
      }
      if (errors.length > 0) return res.status(400).json({ errors });

      if (!fs.existsSync(cvPath) || !fs.existsSync(transcriptPath)) {
        return res.status(400).json({
          errors: ['Uploaded documents are missing on the server. Please upload your PDFs again.'],
        });
      }

      if (freshCv) {
        const cvValidation = await validateUploadedFile(freshCv, ['application/pdf']);
        if (!cvValidation.valid) {
          return res.status(400).json({ error: 'Invalid file type.' });
        }
      }
      if (freshTranscript) {
        const transcriptValidation = await validateUploadedFile(freshTranscript, ['application/pdf']);
        if (!transcriptValidation.valid) {
          return res.status(400).json({ error: 'Invalid file type.' });
        }
      }

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

      if (eligibilityPass) {
        try {
          const settings = await getSettings();
          const positionType = app.position_type || 'tutor';
          const scanResult = await screenApplication({
            cvPath,
            transcriptPath,
            claimedAverage:  parseFloat(app.gpa),
            tutorModuleName: app.module_name,
            settings,
            positionType,
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
          screening = {
            error: true,
            note: 'Document screening could not be completed: ' + scanErr.message,
          };
        }
      }

      const newStatus        = eligibilityPass ? 'submitted' : 'rejected';
      const screeningPayload = screening
        ? { ...screening, rejectionDetail: rejectionDetail || null }
        : null;

      await pool.query(
        `UPDATE applications
         SET cv_filename         = $1,
             transcript_filename = $2,
             cv_original_name    = $3,
             transcript_original_name = $4,
             declared            = TRUE,
             status              = $5,
             rejection_reason    = $6,
             cv_keyword_score    = $7,
             screening_result    = $8,
             submitted_at        = NOW()
         WHERE user_id = $9`,
        [
          cvStoragePath,
          transcriptStoragePath,
          cvOriginalName,
          transcriptOriginalName,
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
           a.position_type,
           a.cost_centre,
           a.cv_filename,
           a.cv_original_name,
           a.cv_keyword_score,
           a.screening_result,
           a.transcript_filename,
           a.transcript_original_name,
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
          a.position_type,
          a.cost_centre,
          a.cv_filename,
          a.cv_original_name,
          a.cv_keyword_score,
          a.screening_result,
          a.transcript_filename,
          a.transcript_original_name,
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


router.patch(
  '/:id/approve',
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    const appId = parseInt(req.params.id);
    const { responsibilityLevel, costCentre } = req.body;

    if (!['standard', 'senior', 'lead'].includes(responsibilityLevel)) {
      return res.status(400).json({
        errors: ['Responsibility level must be standard, senior, or lead.'],
      });
    }

    if (!['school_of_computing', 'ucdg'].includes(costCentre)) {
      return res.status(400).json({
        errors: ['Cost centre must be school_of_computing or ucdg.'],
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
             cost_centre           = $3,
             reviewed_at           = NOW()
         WHERE id = $4`,
        [responsibilityLevel, assignedLecturerId, costCentre, appId]
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
