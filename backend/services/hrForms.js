'use strict';

const { getAppSettings } = require('./settings');
const {
  generateAppointmentFormD,
  generateConfirmationForm,
} = require('./formGenerator');
const {
  loadApprovedApplicationFormDataForUser,
  formPdfFilenames,
} = require('./appointmentForms');

/**
 * Tutor-facing HR PDFs — same Puppeteer pipeline as admin (formGenerator).
 * kind: appointment-form-d | confirmation-form | acceptance-letter
 */
async function generateHrFormPdf(pool, userId, kind, options = {}) {
  const application = await loadApprovedApplicationFormDataForUser(pool, userId);
  const settings = await getAppSettings();
  const names = formPdfFilenames(application);
  const browser = options.browser || null;

  if (kind === 'appointment-form-d') {
    const pdf = await generateAppointmentFormD({
      application,
      settings,
      browser,
    });
    return {
      buffer: Buffer.from(pdf),
      filename: names.formD,
      contentType: 'application/pdf',
    };
  }

  if (kind === 'confirmation-form' || kind === 'acceptance-letter') {
    const pdf = await generateConfirmationForm({
      application,
      settings,
      browser,
    });
    return {
      buffer: Buffer.from(pdf),
      filename: names.confirmation,
      contentType: 'application/pdf',
    };
  }

  const err = new Error('Unknown HR form type.');
  err.status = 404;
  throw err;
}

module.exports = {
  generateHrFormPdf,
};
