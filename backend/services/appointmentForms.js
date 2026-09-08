'use strict';

const APPLICATION_FORM_SELECT = `
  a.*,
  u.title, u.initials, u.first_names, u.surname, u.email, u.cell,
  u.staff_number, u.student_number,
  u.residential_street, u.residential_city, u.residential_postal_code,
  u.residential_same_as_postal,
  u.id_document_filename,
  u.tax_proof_filename AS user_tax_proof_filename,
  u.bank_proof_filename AS user_bank_proof_filename,
  tp.id_number,
  tp.street_address AS postal_street,
  tp.city AS postal_city,
  tp.postal_code,
  tp.bank_name AS bank,
  tp.branch_code AS branch,
  tp.account_number AS accnum,
  tp.account_holder AS accholder,
  tp.tax_number AS taxnum
`;

function sanitizeFilenamePart(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '_');
}

function formPdfFilenames(application) {
  const surname = sanitizeFilenamePart(application.surname);
  const firstNames = sanitizeFilenamePart(application.first_names);
  return {
    formD: `AppointmentFormD_${surname}_${firstNames}.pdf`,
    confirmation: `ConfirmationForm_${surname}_${firstNames}.pdf`,
  };
}

async function loadApplicationFormData(pool, applicationId) {
  const result = await pool.query(
    `SELECT ${APPLICATION_FORM_SELECT}
     FROM applications a
     JOIN users u ON u.id = a.user_id
     LEFT JOIN tutor_profiles tp ON tp.user_id = a.user_id
     WHERE a.id = $1`,
    [applicationId]
  );

  if (!result.rows.length) {
    const err = new Error('Application not found.');
    err.status = 404;
    throw err;
  }

  return result.rows[0];
}

async function loadApprovedApplicationFormDataForUser(pool, userId) {
  const result = await pool.query(
    `SELECT ${APPLICATION_FORM_SELECT}
     FROM applications a
     JOIN users u ON u.id = a.user_id
     LEFT JOIN tutor_profiles tp ON tp.user_id = a.user_id
     WHERE a.user_id = $1 AND a.status = 'approved'
     ORDER BY a.updated_at DESC NULLS LAST, a.id DESC
     LIMIT 1`,
    [userId]
  );

  if (!result.rows.length) {
    const err = new Error(
      'HR forms are only available after your appointment is approved.'
    );
    err.status = 403;
    throw err;
  }

  return result.rows[0];
}

module.exports = {
  loadApplicationFormData,
  loadApprovedApplicationFormDataForUser,
  sanitizeFilenamePart,
  formPdfFilenames,
};
