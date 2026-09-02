'use strict';

const router       = require('express').Router();
const authenticate = require('../middleware/authenticate');
const requireRole  = require('../middleware/requireRole');
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

router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const settings = await getAppSettings();
    return res.status(200).json(settings);
  } catch (err) {
    console.error('Get settings error:', err.message);
    return res.status(500).json({ errors: ['Server error.'] });
  }
});

router.patch('/', authenticate, requireRole('admin'), async (req, res) => {
  const updates = {};
  for (const field of ALLOWED_FIELDS) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ errors: ['No valid settings provided.'] });
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

  try {
    const previous = await getAppSettings();
    const applicationsJustOpened =
      !previous.applications_open &&
      (updates.applications_open === true || updates.applications_open === 'true');

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
