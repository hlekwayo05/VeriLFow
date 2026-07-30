'use strict';

/**
 * Strong password policy for account creation and password changes.
 * Login keeps a looser check so existing accounts can still sign in.
 */

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 64;
const SPECIAL_RE = /[!@#$%^&*()_\-+=\[\]{};':"\\|,.<>\/?`~]/;

const PASSWORD_HINT =
  `At least ${PASSWORD_MIN} characters, with uppercase, lowercase, a number, and a special character.`;

function passwordIssues(password) {
  const value = String(password ?? '');
  const issues = [];

  if (value.length < PASSWORD_MIN) {
    issues.push(`at least ${PASSWORD_MIN} characters`);
  }
  if (value.length > PASSWORD_MAX) {
    issues.push(`no more than ${PASSWORD_MAX} characters`);
  }
  if (!/[A-Z]/.test(value)) {
    issues.push('an uppercase letter');
  }
  if (!/[a-z]/.test(value)) {
    issues.push('a lowercase letter');
  }
  if (!/[0-9]/.test(value)) {
    issues.push('a number');
  }
  if (!SPECIAL_RE.test(value)) {
    issues.push('a special character (e.g. !@#$%)');
  }

  return issues;
}

function isStrongPassword(password) {
  return passwordIssues(password).length === 0;
}

function passwordErrorMessage(password) {
  const issues = passwordIssues(password);
  if (!issues.length) return null;
  if (issues.length === 1) {
    return `Password must include ${issues[0]}.`;
  }
  const last = issues.pop();
  return `Password must include ${issues.join(', ')}, and ${last}.`;
}

/** express-validator chain helper */
function strongPasswordRules(field = 'password', label = 'Password') {
  const { body } = require('express-validator');
  return body(field)
    .notEmpty().withMessage(`${label} is required.`)
    .isString().withMessage(`${label} must be a string.`)
    .isLength({ min: PASSWORD_MIN, max: PASSWORD_MAX })
      .withMessage(`${label} must be between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters.`)
    .custom((value) => {
      const msg = passwordErrorMessage(value);
      if (msg) throw new Error(msg.replace(/^Password/, label));
      return true;
    });
}

module.exports = {
  PASSWORD_MIN,
  PASSWORD_MAX,
  PASSWORD_HINT,
  SPECIAL_RE,
  passwordIssues,
  isStrongPassword,
  passwordErrorMessage,
  strongPasswordRules,
};
