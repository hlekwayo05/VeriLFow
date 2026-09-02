
'use strict';

const { body, validationResult } = require('express-validator');
const pool = require('../db');
const { handleValidationErrors } = require('./handleValidationErrors');

const validateAcademicSave = [
  body('faculty')
    .trim()
    .notEmpty().withMessage('Faculty is required.')
    .escape(),
  body('course')
    .trim()
    .notEmpty().withMessage('Course is required.')
    .escape(),
  body('qualificationLevel')
    .notEmpty().withMessage('Qualification level is required.'),
  body('moduleYearLevel')
    .trim()
    .notEmpty().withMessage('Year/semester level is required.')
    .escape(),
  body('moduleName')
    .trim()
    .notEmpty().withMessage('Module is required.')
    .escape(),
  body('moduleCode')
    .trim()
    .notEmpty().withMessage('Module code is required.'),
  body('gpa')
    .notEmpty().withMessage('GPA / academic average is required.')
    .isFloat({ min: 0, max: 100 }).withMessage('GPA must be a number between 0 and 100.'),
  body('positionType')
    .notEmpty().withMessage('Position type is required.')
    .isIn(['tutor', 'demonstrator']).withMessage('Position type must be tutor or demonstrator.'),
  handleValidationErrors,
];

const validateSubmitApplication = [
  body('declared')
    .exists().withMessage('You must accept the declaration before submitting.')
    .equals('true').withMessage('You must accept the declaration before submitting.'),
  body().custom(async (value, { req }) => {
    const hasFreshCv = !!(req.files && req.files['cvFile']);
    const hasFreshTranscript = !!(req.files && req.files['transcriptFile']);

    let hasSavedCv = false;
    let hasSavedTranscript = false;

    if (!hasFreshCv || !hasFreshTranscript) {
      const { rows } = await pool.query(
        `SELECT cv_filename, transcript_filename FROM applications WHERE user_id = $1`,
        [req.user.userId]
      );
      hasSavedCv = !!(rows[0] && rows[0].cv_filename);
      hasSavedTranscript = !!(rows[0] && rows[0].transcript_filename);
    }

    const missing = [];
    if (!hasFreshCv && !hasSavedCv) missing.push('CV (PDF) is required.');
    if (!hasFreshTranscript && !hasSavedTranscript) missing.push('Academic transcript (PDF) is required.');
    if (missing.length) throw new Error(missing.join(' '));
    return true;
  }),
  handleValidationErrors,
];

module.exports = {
  handleValidationErrors,
  validateAcademicSave,
  validateSubmitApplication,
};
