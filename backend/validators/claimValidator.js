'use strict';

const { body, param, query, validationResult } = require('express-validator');

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

const validateTimesheetQuery = [
  query('periodMonth')
    .optional()
    .isInt({ min: 1, max: 12 }).withMessage('Valid period month (1-12) is required.'),
  query('periodYear')
    .optional()
    .isInt({ min: 2020 }).withMessage('Valid period year is required.'),
  query('moduleCode')
    .optional({ nullable: true })
    .trim()
    .notEmpty().withMessage('moduleCode is required.')
    .escape(),
  handleValidationErrors,
];

const validateCreateClaim = [
  body('periodMonth')
    .notEmpty().withMessage('Valid period month (1-12) is required.')
    .isInt({ min: 1, max: 12 }).withMessage('Valid period month (1-12) is required.'),
  body('periodYear')
    .notEmpty().withMessage('Valid period year is required.')
    .isInt({ min: 2020 }).withMessage('Valid period year is required.'),
  body('lecturerId')
    .notEmpty().withMessage('Lecturer ID is required.')
    .isInt({ min: 1 }).withMessage('Lecturer ID must be a positive integer.'),
  body('moduleCode')
    .trim()
    .notEmpty().withMessage('Module code is required.')
    .escape(),
  body('sessionIds')
    .isArray({ min: 1 }).withMessage('At least one session must be included in the claim.'),
  handleValidationErrors,
];

const validateSessionIds = [
  body('sessionIds')
    .isArray({ min: 1 }).withMessage('At least one session must be included.'),
  handleValidationErrors,
];

const validateClaimNote = [
  body('note')
    .trim()
    .notEmpty().withMessage('Return note is required.'),
  handleValidationErrors,
];

const validateClaimIdParam = [
  param('id')
    .isInt({ min: 1 }).withMessage('Claim ID must be a positive integer.'),
  handleValidationErrors,
];

module.exports = {
  handleValidationErrors,
  validateTimesheetQuery,
  validateCreateClaim,
  validateSessionIds,
  validateClaimNote,
  validateClaimIdParam,
};
