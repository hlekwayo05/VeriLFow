'use strict';

const router       = require('express').Router();
const authenticate = require('../middleware/authenticate');
const requireRole  = require('../middleware/requireRole');
const { adminActionLimiter } = require('../middleware/rateLimiter');
const { getAppSettings, updateSettings } = require('../services/settings');
const { sendAnnouncementEmail } = require('../services/mailer');

const ALLOWED_FIELDS = [
  'min_average',
  'module_pass_mark',
  'cv_keywords',
  'min_cv_keywords',
  'applications_open',
  'closing_date',
  'announcement_subject',
  'announcement_body',
  'rate_undergrad',
  'rate_honours',
  'rate_masters',
  'max_hours_per_semester',
  'appointment_period_start',
  'appointment_period_end',
  'appointment_start_date',
  'appointment_end_date',
  'director_name',
  'director_title',
  'director_email',
  'school_approver_name',
  'ucdg_approver_name',
];

const STRING_LIMITS = {
  cv_keywords: 2000,
  announcement_subject: 200,
  announcement_body: 5000,
  director_name: 200,
  director_title: 200,
  director_email: 200,
  school_approver_name: 200,
  ucdg_approver_name: 200,
};

const DATE_FIELDS = [
  'closing_date',
  'appointment_period_start',
  'appointment_period_end',
  'appointment_start_date',
  'appointment_end_date',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function asBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return null;
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value));
}

router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const settings = await getAppSettings();
    return res.status(200).json(settings);
  } catch (err) {
    console.error('Get settings error:', err.message);
    return res.status(500).json({ errors: ['Server error.'] });
  }
});

router.patch(
  '/',
  adminActionLimiter,
  authenticate,
  requireRole('admin'),
  async (req, res) => {
  const updates = {};
  for (const field of ALLOWED_FIELDS) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ errors: ['No valid settings provided.'] });
  }

  if (updates.applications_open !== undefined) {
    const coerced = asBoolean(updates.applications_open);
    if (coerced === null) {
      return res.status(400).json({ errors: ['applications_open must be true or false.'] });
    }
    updates.applications_open = coerced;
  }

  if (updates.min_average != null) {
    const n = parseFloat(updates.min_average);
    if (isNaN(n) || n < 0 || n > 100) {
      return res.status(400).json({ errors: ['Minimum average must be between 0 and 100.'] });
    }
  }

  if (updates.module_pass_mark != null) {
    const n = parseFloat(updates.module_pass_mark);
    if (isNaN(n) || n < 0 || n > 100) {
      return res.status(400).json({ errors: ['Module pass mark must be between 0 and 100.'] });
    }
  }

  if (updates.min_cv_keywords != null) {
    const n = parseInt(updates.min_cv_keywords, 10);
    if (isNaN(n) || n < 0) {
      return res.status(400).json({ errors: ['Min CV keywords must be zero or greater.'] });
    }
  }

  for (const key of ['rate_undergrad', 'rate_honours', 'rate_masters']) {
    if (updates[key] != null) {
      const n = parseFloat(updates[key]);
      if (isNaN(n) || n < 0) {
        return res.status(400).json({ errors: [`${key} must be zero or greater.`] });
      }
    }
  }

  if (updates.max_hours_per_semester != null) {
    const n = parseInt(updates.max_hours_per_semester, 10);
    if (isNaN(n) || n < 1) {
      return res.status(400).json({ errors: ['Max hours per semester must be at least 1.'] });
    }
  }

  for (const [field, maxLen] of Object.entries(STRING_LIMITS)) {
    if (updates[field] == null) continue;
    const value = String(updates[field]);
    if (value.length > maxLen) {
      return res.status(400).json({
        errors: [`${field} must be at most ${maxLen} characters.`],
      });
    }
    updates[field] = value;
  }

  if (updates.director_email != null && String(updates.director_email).trim()) {
    const email = String(updates.director_email).trim();
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ errors: ['Director email is not valid.'] });
    }
    updates.director_email = email;
  }

  for (const field of DATE_FIELDS) {
    if (updates[field] === undefined) continue;
    if (updates[field] === null || updates[field] === '') {
      updates[field] = null;
      continue;
    }
    if (!isIsoDate(updates[field])) {
      return res.status(400).json({
        errors: [`${field} must be a date in YYYY-MM-DD format.`],
      });
    }
  }

  try {
    const previous = await getAppSettings();
    const applicationsJustOpened =
      !previous.applications_open && updates.applications_open === true;

    const settings = await updateSettings(updates);

    if (applicationsJustOpened) {
      sendAnnouncementEmail(settings)
        .then((result) => {
          console.log('Announcement email sent', result);
        })
        .catch((err) => {
          console.error('Announcement email failed:', err);
        });
    }

    return res.status(200).json(settings);
  } catch (err) {
    console.error('Update settings error:', err.message);
    return res.status(500).json({ errors: ['Server error.'] });
  }
});

module.exports = router;
