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

function sanitizeFilenamePart(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '_');
}

// GET /api/appointments/:applicationId/form-d
// Downloads pre-filled Appointment Form D as PDF
router.get(
  '/:applicationId/form-d',
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    try {
      const appId = parseInt(req.params.applicationId, 10);

      const result = await pool.query(
        `SELECT
          a.*,
          u.title, u.initials, u.first_names, u.surname, u.email, u.cell, u.staff_number,
          tp.id_number,
          tp.street_address AS postal_street,
          tp.city AS postal_city,
          tp.postal_code,
          u.residential_street, u.residential_city, u.residential_postal_code,
          u.residential_same_as_postal,
          tp.bank_name AS bank,
          tp.branch_code AS branch,
          tp.account_number AS accnum,
          tp.account_holder AS accholder,
          tp.tax_number AS taxnum
        FROM applications a
        JOIN users u ON u.id = a.user_id
        LEFT JOIN tutor_profiles tp ON tp.user_id = a.user_id
        WHERE a.id = $1`,
        [appId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          errors: ['Application not found.'],
        });
      }

      const application = result.rows[0];
      const settings = await getAppSettings();

      const pdf = await generateAppointmentFormD({
        application,
        settings,
      });

      const surname = sanitizeFilenamePart(application.surname);
      const firstNames = sanitizeFilenamePart(application.first_names);

      res.setHeader('Content-Type', 'application/pdf');
      const inline = req.query.inline === '1' || req.query.inline === 'true';
      res.setHeader(
        'Content-Disposition',
        `${inline ? 'inline' : 'attachment'}; filename="AppointmentFormD_${surname}_${firstNames}.pdf"`
      );
      return res.send(Buffer.from(pdf));
    } catch (err) {
      console.error('Form D generation error:', err.message);
      return res.status(500).json({
        errors: ['Could not generate form.'],
      });
    }
  }
);

// GET /api/appointments/:applicationId/confirmation
// Downloads pre-filled Confirmation Form as PDF
router.get(
  '/:applicationId/confirmation',
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    try {
      const appId = parseInt(req.params.applicationId, 10);

      const result = await pool.query(
        `SELECT
          a.*,
          u.first_names, u.surname, u.email
        FROM applications a
        JOIN users u ON u.id = a.user_id
        WHERE a.id = $1`,
        [appId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          errors: ['Application not found.'],
        });
      }

      const application = result.rows[0];
      const settings = await getAppSettings();

      const pdf = await generateConfirmationForm({
        application,
        settings,
      });

      const surname = sanitizeFilenamePart(application.surname);
      const firstNames = sanitizeFilenamePart(application.first_names);

      res.setHeader('Content-Type', 'application/pdf');
      const inline = req.query.inline === '1' || req.query.inline === 'true';
      res.setHeader(
        'Content-Disposition',
        `${inline ? 'inline' : 'attachment'}; filename="ConfirmationForm_${surname}_${firstNames}.pdf"`
      );
      return res.send(Buffer.from(pdf));
    } catch (err) {
      console.error('Confirmation form error:', err.message);
      return res.status(500).json({
        errors: ['Could not generate form.'],
      });
    }
  }
);

module.exports = router;
