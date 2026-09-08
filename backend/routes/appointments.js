'use strict';

const router = require('express').Router();
const pool = require('../db');
const authenticate = require('../middleware/authenticate');
const requireRole = require('../middleware/requireRole');
const { getAppSettings } = require('../services/settings');
const {
  generateAppointmentFormD,
  generateConfirmationForm,
} = require('../services/formGenerator');
const {
  loadApplicationFormData,
  formPdfFilenames,
} = require('../services/appointmentForms');

// GET /api/appointments/:applicationId/form-d
router.get(
  '/:applicationId/form-d',
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    try {
      const appId = parseInt(req.params.applicationId, 10);
      const application = await loadApplicationFormData(pool, appId);
      const settings = await getAppSettings();
      const pdf = await generateAppointmentFormD({ application, settings });
      const { formD } = formPdfFilenames(application);

      res.setHeader('Content-Type', 'application/pdf');
      const inline = req.query.inline === '1' || req.query.inline === 'true';
      res.setHeader(
        'Content-Disposition',
        `${inline ? 'inline' : 'attachment'}; filename="${formD}"`
      );
      return res.send(Buffer.from(pdf));
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('Form D generation error:', err.message);
      return res.status(status).json({
        errors: [err.message || 'Could not generate form.'],
      });
    }
  }
);

// GET /api/appointments/:applicationId/confirmation
router.get(
  '/:applicationId/confirmation',
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    try {
      const appId = parseInt(req.params.applicationId, 10);
      const application = await loadApplicationFormData(pool, appId);
      const settings = await getAppSettings();
      const pdf = await generateConfirmationForm({ application, settings });
      const { confirmation } = formPdfFilenames(application);

      res.setHeader('Content-Type', 'application/pdf');
      const inline = req.query.inline === '1' || req.query.inline === 'true';
      res.setHeader(
        'Content-Disposition',
        `${inline ? 'inline' : 'attachment'}; filename="${confirmation}"`
      );
      return res.send(Buffer.from(pdf));
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('Confirmation form error:', err.message);
      return res.status(status).json({
        errors: [err.message || 'Could not generate form.'],
      });
    }
  }
);

module.exports = router;
