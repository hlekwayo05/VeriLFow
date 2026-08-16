
'use strict';

const { body, validationResult } = require('express-validator');
const { strongPasswordRules } = require('../utils/passwordPolicy');
const { handleValidationErrors } = require('./handleValidationErrors');

const validateLogin = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required.')
    .isEmail().withMessage('Please enter a valid email.')
    .normalizeEmail(),
  body('password')
    .notEmpty().withMessage('Password is required.')
    .isString().withMessage('Password must be a string.')
    .isLength({ min: 1, max: 64 }).withMessage('Password must be between 1 and 64 characters.'),
  handleValidationErrors,
];

const validateRegister = [
  body('firstNames')
    .trim()
    .notEmpty().withMessage('First name(s) are required.')
    .isLength({ min: 2, max: 100 }).withMessage('First name(s) must be between 2 and 100 characters.')
    .escape(),
  body('surname')
    .trim()
    .notEmpty().withMessage('Surname is required.')
    .isLength({ min: 2, max: 100 }).withMessage('Surname must be between 2 and 100 characters.')
    .escape(),
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required.')
    .isEmail().withMessage('Please enter a valid email.')
    .normalizeEmail(),
  strongPasswordRules('password', 'Password'),
  body('studentNumber')
    .trim()
    .notEmpty().withMessage('Student number is required.')
    .isNumeric().withMessage('Student number must be numeric.')
    .isLength({ min: 5, max: 15 }).withMessage('Student number must be between 5 and 15 digits.'),
  body('confirm')
    .trim()
    .notEmpty().withMessage('Please confirm your password.')
    .custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('Passwords do not match.');
      }
      return true;
    }),
  handleValidationErrors,
];

const validateChangePassword = [
  body('currentPassword')
    .notEmpty().withMessage('Current password is required.')
    .isString().withMessage('Current password must be a string.')
    .isLength({ min: 1, max: 64 }).withMessage('Current password is required.'),
  strongPasswordRules('newPassword', 'New password'),
  body('confirmPassword')
    .notEmpty().withMessage('Confirm password is required.')
    .isString().withMessage('Confirm password must be a string.')
    .custom((value, { req }) => {
      if (value !== req.body.newPassword) {
        throw new Error('Passwords do not match.');
      }
      return true;
    }),
  handleValidationErrors,
];

const validateForgotPassword = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required.')
    .isEmail().withMessage('Please enter a valid email.')
    .normalizeEmail(),
  handleValidationErrors,
];

const validateResetPassword = [
  body('token')
    .trim()
    .notEmpty().withMessage('Token is required.'),
  strongPasswordRules('password', 'Password'),
  handleValidationErrors,
];

module.exports = {
  handleValidationErrors,
  validateLogin,
  validateRegister,
  validateChangePassword,
  validateForgotPassword,
  validateResetPassword,
};
