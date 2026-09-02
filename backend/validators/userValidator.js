
'use strict';

const { body, param, validationResult } = require('express-validator');
const { handleValidationErrors } = require('./handleValidationErrors');

const validateOnboardingStep1 = [
  body('idNumber')
    .trim()
    .notEmpty().withMessage('Valid 13-digit ID number is required.')
    .matches(/^\d{13}$/).withMessage('Valid 13-digit ID number is required.'),
  body('postal.street')
    .trim()
    .notEmpty().withMessage('Postal street address is required.')
    .escape(),
  body('postal.city')
    .trim()
    .notEmpty().withMessage('Postal city is required.')
    .escape(),
  body('postal.code')
    .trim()
    .notEmpty().withMessage('Valid postal code is required.')
    .matches(/^\d{4}$/).withMessage('Valid postal code is required.'),
  body('residentialSameAsPostal')
    .optional()
    .isBoolean().withMessage('Residential same as postal must be a boolean.'),
  body('residentialStreet')
    .optional({ nullable: true })
    .trim()
    .escape(),
  body('residentialCity')
    .optional({ nullable: true })
    .trim()
    .escape(),
  body('residentialPostalCode')
    .optional({ nullable: true })
    .trim()
    .matches(/^\d{4}$/).withMessage('Valid residential postal code is required.'),
  body().custom((value, { req }) => {
    const sameAsPostal = req.body.residentialSameAsPostal === true || req.body.residentialSameAsPostal === 'true';
    if (!sameAsPostal) {
      const residentialStreet = String(req.body.residentialStreet || '').trim();
      const residentialCity = String(req.body.residentialCity || '').trim();
      const residentialPostalCode = String(req.body.residentialPostalCode || '').trim();
      if (!residentialStreet) {
        throw new Error('Residential street address is required.');
      }
      if (!residentialCity) {
        throw new Error('Residential city is required.');
      }
      if (!/^\d{4}$/.test(residentialPostalCode)) {
        throw new Error('Valid residential postal code is required.');
      }
    }
    return true;
  }),
  handleValidationErrors,
];

/*const validateOnboardingStep2 = [
  body('bank')
    .trim()
    .notEmpty().withMessage('Bank name is required.')
    .escape(),
  body('branch')
    .trim()
    .notEmpty().withMessage('Valid 6-digit branch code is required.')
    .matches(/^\d{6}$/).withMessage('Valid 6-digit branch code is required.'),
  body('acctype')
    .trim()
    .notEmpty().withMessage('Account type is required.')
    .escape(),
  body('accnum')
    .trim()
    .notEmpty().withMessage('Valid account number is required.')
    .isLength({ min: 8 }).withMessage('Valid account number is required.'),
  body('accholder')
    .trim()
    .notEmpty().withMessage('Account holder name is required.')
    .escape(),
  body('taxnum')
    .trim()
    .notEmpty().withMessage('Valid tax number is required.')
    .matches(/^\d{9,}$/).withMessage('Valid tax number is required.'),
  handleValidationErrors,
];*/
const validateOnboardingStep2 = [
  body('bank')
    .trim()
    .notEmpty().withMessage('Bank name is required.')
    .escape(),
  body('branch')
    .trim()
    .notEmpty().withMessage('Valid 6-digit branch code is required.')
    .matches(/^\d{6}$/).withMessage('Valid 6-digit branch code is required.'),
  body('acctype')
    .trim()
    .notEmpty().withMessage('Account type is required.')
    .isIn(['Cheque / Current', 'Savings', 'Transmission']).withMessage('Please select a valid account type.'),
  body('accnum')
    .trim()
    .notEmpty().withMessage('Account number is required.')
    .isNumeric().withMessage('Account number must contain digits only.')
    .isLength({ min: 8, max: 13 }).withMessage('Account number must be between 8 and 13 digits.'),
  body('accholder')
    .trim()
    .notEmpty().withMessage('Account holder name is required.')
    .escape(),
  body('taxnum')
    .trim()
    .notEmpty().withMessage('Valid tax number is required.')
    .matches(/^\d{9,10}$/).withMessage('Tax number must be 9 or 10 digits.'),
  handleValidationErrors,
];

const validateOnboardingDocuments = [
  body().custom((value, { req }) => {
    if (!req.files || !Object.keys(req.files).length) {
      throw new Error('No files uploaded.');
    }
    return true;
  }),
  handleValidationErrors,
];

const validateProfileUpdate = [
  body('studentNumber')
    .optional({ nullable: true })
    .custom((value) => {
      if (value === undefined || value === null || value === '') return true;
      const studentNo = String(value).trim();
      if (studentNo.length < 5) {
        throw new Error('Student number must be at least 5 characters.');
      }
      return true;
    }),
  body('cellPhone')
    .optional({ nullable: true })
    .custom((value) => {
      if (value === undefined || value === null || value === '') return true;
      const cell = String(value).trim();
      if (cell.length < 9) {
        throw new Error('Cell phone number must be at least 9 digits.');
      }
      return true;
    }),
  handleValidationErrors,
];

const validateCreateLecturer = [
  body('firstName')
    .trim()
    .notEmpty().withMessage('First name is required.')
    .escape(),
  body('surname')
    .trim()
    .notEmpty().withMessage('Surname is required.')
    .escape(),
  body('email')
    .trim()
    .notEmpty().withMessage('Valid email is required.')
    .isEmail().withMessage('Valid email is required.')
    .normalizeEmail(),
  body('modules')
    .isArray({ min: 1 }).withMessage('At least one module must be assigned.'),
  body('modules.*.code')
    .optional({ nullable: true })
    .trim()
    .notEmpty().withMessage('Module code is required.')
    .escape(),
  body('modules.*.name')
    .optional({ nullable: true })
    .trim()
    .notEmpty().withMessage('Module name is required.')
    .escape(),
  body('modules.*.course')
    .optional({ nullable: true })
    .trim()
    .notEmpty().withMessage('Module course is required.')
    .escape(),
  handleValidationErrors,
];

const validateAddLecturerModule = [
  param('id')
    .isInt({ min: 1 }).withMessage('Lecturer ID must be a positive integer.'),
  body('code')
    .trim()
    .notEmpty().withMessage('Module code is required.')
    .escape(),
  body('name')
    .trim()
    .notEmpty().withMessage('Module name is required.')
    .escape(),
  body('course')
    .trim()
    .notEmpty().withMessage('Module course is required.')
    .escape(),
  handleValidationErrors,
];

const validateImportLecturers = [
  body('lecturers')
    .isArray({ min: 1 }).withMessage('Provide an array of lecturers.'),
  handleValidationErrors,
];

const validateResetPassword = [
  param('role')
    .isIn(['lecturer', 'tutor']).withMessage('Role must be lecturer or tutor.'),
  param('id')
    .isInt({ min: 1 }).withMessage('User ID must be a positive integer.'),
  handleValidationErrors,
];

module.exports = {
  handleValidationErrors,
  validateOnboardingStep1,
  validateOnboardingStep2,
  validateOnboardingDocuments,
  validateProfileUpdate,
  validateCreateLecturer,
  validateImportLecturers,
  validateAddLecturerModule,
  validateResetPassword,
};
