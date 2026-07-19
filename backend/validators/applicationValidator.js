'use strict';

const { body, validationResult } = require('express-validator');

function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return res.status(400).json({
      errors: errors.array().map((error) => ({
        field: error.path || error.param,
        message: error.msg,
      })),
    });
  }

  next();
}

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
  handleValidationErrors,
];

const validateSubmitApplication = [
  body('declared')
    .exists().withMessage('You must accept the declaration before submitting.')
    .equals('true').withMessage('You must accept the declaration before submitting.'),
  body().custom((value, { req }) => {
    const missing = [];
    if (!req.files || !req.files['cvFile']) missing.push('CV (PDF) is required.');
    if (!req.files || !req.files['transcriptFile']) missing.push('Academic transcript (PDF) is required.');
    if (missing.length) {
      throw new Error(missing.join(' '));
    }
    return true;
  }),
  handleValidationErrors,
];

module.exports = {
  handleValidationErrors,
  validateAcademicSave,
  validateSubmitApplication,
};
