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

const validateCreateStudent = [
  body(['first_names', 'firstNames'])
    .custom((value, { req }) => {
      const firstNameValue = String(req.body.first_names || req.body.firstNames || '').trim();
      if (!firstNameValue) {
        throw new Error('First names are required.');
      }
      return true;
    }),
  body('first_names').optional({ nullable: true }).trim().escape(),
  body('firstNames').optional({ nullable: true }).trim().escape(),
  body('surname')
    .trim()
    .notEmpty().withMessage('Surname is required.')
    .escape(),
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required.')
    .isEmail().withMessage('Email must be a valid email address.')
    .normalizeEmail(),
  body(['student_number', 'studentNumber'])
    .optional({ nullable: true })
    .custom((value, { req }) => {
      const studentNo = String(req.body.student_number || req.body.studentNumber || '').trim();
      if (studentNo && studentNo.length < 1) {
        throw new Error('Student number must not be empty.');
      }
      return true;
    }),
  body('programme')
    .optional({ nullable: true })
    .trim()
    .escape(),
  body('year_level').optional({ nullable: true }).trim().escape(),
  body('yearLevel').optional({ nullable: true }).trim().escape(),
  handleValidationErrors,
];

const validateImportStudents = [
  body('students')
    .isArray({ min: 1 }).withMessage('Provide an array of students.'),
  handleValidationErrors,
];

module.exports = {
  handleValidationErrors,
  validateCreateStudent,
  validateImportStudents,
};
