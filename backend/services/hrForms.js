'use strict';

const PDFDocument = require('pdfkit');
const { getRateEntry } = require('../constants');
const { getAppSettings } = require('./settings');

function dash(v) {
  if (v == null || String(v).trim() === '') return '—';
  return String(v).trim();
}

function formatDateLong(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-ZA', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function formatDateShort(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-ZA', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function positionLabel(positionType) {
  return positionType === 'demonstrator' ? 'Demonstrator' : 'Tutor';
}

function resolveHourlyRate(app) {
  if (!app?.qualification_level || !app?.responsibility_level) return null;
  try {
    const entry = getRateEntry(app.qualification_level, app.responsibility_level);
    return entry?.hourlyRate != null ? Number(entry.hourlyRate) : null;
  } catch {
    return null;
  }
}

function buildPostalAddress(profile) {
  if (!profile?.street_address) return '—';
  return [profile.street_address, profile.city, profile.postal_code]
    .filter(Boolean)
    .join(', ');
}

function buildResidentialAddress(user, profile) {
  if (user?.residential_same_as_postal) {
    return buildPostalAddress(profile);
  }
  if (user?.residential_street) {
    return [user.residential_street, user.residential_city, user.residential_postal_code]
      .filter(Boolean)
      .join(', ');
  }
  return buildPostalAddress(profile);
}

async function loadHrFormContext(pool, userId) {
  const result = await pool.query(
    `SELECT
       u.id,
       u.title,
       u.initials,
       u.first_names,
       u.surname,
       u.email,
       u.cell,
       u.student_number,
       u.residential_street,
       u.residential_city,
       u.residential_postal_code,
       u.residential_same_as_postal,
       tp.id_number,
       tp.street_address,
       tp.city,
       tp.postal_code,
       tp.bank_name,
       tp.branch_code,
       tp.account_type,
       tp.account_number,
       tp.account_holder,
       tp.tax_number,
       a.position_type,
       a.qualification_level,
       a.responsibility_level,
       a.module_name,
       a.module_code,
       a.cost_centre,
       a.status AS application_status
     FROM users u
     LEFT JOIN tutor_profiles tp ON tp.user_id = u.id
     LEFT JOIN LATERAL (
       SELECT position_type, qualification_level, responsibility_level,
              module_name, module_code, cost_centre, status
       FROM applications
       WHERE user_id = u.id AND status = 'approved'
       ORDER BY updated_at DESC NULLS LAST, id DESC
       LIMIT 1
     ) a ON true
     WHERE u.id = $1`,
    [userId]
  );

  if (!result.rows.length) {
    const err = new Error('User not found.');
    err.status = 404;
    throw err;
  }

  const row = result.rows[0];
  if (row.application_status !== 'approved') {
    const err = new Error('HR forms are only available after your appointment is approved.');
    err.status = 403;
    throw err;
  }

  const settings = await getAppSettings();
  const rate = resolveHourlyRate(row);

  return {
    user: row,
    settings,
    rate,
    roleLabel: positionLabel(row.position_type),
    fullName: `${row.first_names || ''} ${row.surname || ''}`.trim(),
    periodStart: settings.appointment_period_start,
    periodEnd: settings.appointment_period_end,
    directorName: settings.director_name || 'Dr M Madiope',
    directorTitle: settings.director_title || 'Director: Academic Support Services Division',
  };
}

function newDoc() {
  return new PDFDocument({
    size: 'A4',
    margins: { top: 54, bottom: 54, left: 54, right: 54 },
  });
}

function collectPdf(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

function fieldRow(doc, label, value, y) {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#182420').text(label, left, y, { width: 160 });
  doc.font('Helvetica').fontSize(10).fillColor('#182420').text(dash(value), left + 170, y, { width: width - 170 });
  return y + 18;
}

/**
 * Appointment Form D — Consultant / fixed-term appointment details for HR.
 */
async function buildAppointmentFormDPdf(ctx) {
  const doc = newDoc();
  const done = collectPdf(doc);
  const u = ctx.user;
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.font('Helvetica-Bold').fontSize(16).fillColor('#152e2c')
    .text('Appointment Form D — Consultant', left, 54, { width, align: 'center' });

  doc.moveDown(0.6);
  doc.font('Helvetica-Oblique').fontSize(8).fillColor('#5b6864')
    .text(
      'Note: Complete this form using the applicant’s details. Supporting documents (ID, tax proof, banking proof) are attached from the VeriFlow application.',
      { width, align: 'left' }
    );

  let y = doc.y + 14;
  const line = (label, value) => {
    y = fieldRow(doc, label, value, y);
  };

  line('Surname', u.surname);
  line('Title', u.title);
  line('Initials', u.initials);
  line('First Names', u.first_names);
  line('Identity Number', u.id_number);
  line(
    'Duration of appointment',
    `${formatDateShort(ctx.periodStart)} to ${formatDateShort(ctx.periodEnd)}`
  );
  line('Postal Address', buildPostalAddress(u));
  line('Postal code', u.postal_code);
  line('Residential address', buildResidentialAddress(u, u));
  line('Residential code', u.residential_same_as_postal ? u.postal_code : u.residential_postal_code);
  line('Email Address', u.email);
  line('Cellular Phone', u.cell);
  line('Bank Name', u.bank_name);
  line('Branch Code', u.branch_code);
  line('Account Number', u.account_number);
  line('Account Holder Name', u.account_holder);
  line('Income Tax Number', u.tax_number);
  line('Position', ctx.roleLabel);
  line('Module', [u.module_code, u.module_name].filter(Boolean).join(' — ') || '—');
  if (ctx.rate != null) line('Hourly rate', `R ${Number(ctx.rate).toFixed(2)}`);

  y += 10;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#182420').text('Signature and Date', left, y);
  y += 22;
  doc.font('Helvetica').fontSize(9).fillColor('#5b6864')
    .text('Applicant signature: _______________________________     Date: _______________', left, y);

  y += 28;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#182420').text('Supporting documents required', left, y);
  y += 14;
  doc.font('Helvetica').fontSize(9).fillColor('#182420')
    .text('• Copy of Identity Document\n• Proof of Income Tax Number\n• Proof of bank account number\n• Letter of appointment (rate and funding source)', left, y, { width });

  y = doc.y + 20;
  doc.font('Helvetica-Bold').fontSize(10).text('Institutional Approval', left, y);
  y += 16;
  doc.font('Helvetica').fontSize(9).fillColor('#5b6864')
    .text(`Approved by: ${dash(ctx.directorName)} (${dash(ctx.directorTitle)})`, left, y);
  y += 16;
  doc.text('Signature: _______________________________     Date: _______________', left, y);
  y += 24;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#182420').text('HR Confirmation', left, y);
  y += 16;
  doc.font('Helvetica').fontSize(9).fillColor('#5b6864')
    .text('HR data captured by: _______________________________', left, y);
  y += 16;
  doc.text('Signature: _______________________________     Date: _______________', left, y);
  y += 20;
  doc.text('HEMIS employment category: _______________________________', left, y);

  doc.end();
  return done;
}

/**
 * Acceptance / confirmation letter + acceptance-of-offer block.
 */
async function buildAcceptanceLetterPdf(ctx) {
  const doc = newDoc();
  const done = collectPdf(doc);
  const u = ctx.user;
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const today = formatDateLong(new Date());
  const rateText = ctx.rate != null
    ? `R ${Number(ctx.rate).toFixed(2)} per hour`
    : 'R — per hour (rate based on the level of study)';

  doc.font('Helvetica').fontSize(9).fillColor('#5b6864')
    .text(`Date: ${today}`, left, 54)
    .text('Reference: 3/1/6/1/2/2')
    .text('Enquiries: Student Employment Office')
    .text('Email: Mabizweni.machava@ump.ac.za');

  doc.moveDown(1.2);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#182420').text('PERSONAL AND CONFIDENTIAL');

  doc.moveDown(0.8);
  doc.font('Helvetica').fontSize(11).text(`Dear ${dash(ctx.fullName)},`);

  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(11)
    .text(
      `APPOINTMENT AS A ${ctx.roleLabel.toUpperCase()} IN THE ACADEMIC SUPPORT SERVICES DEPARTMENT (FYE PROGRAMME)`,
      { width, align: 'left' }
    );

  doc.moveDown(0.8);
  doc.font('Helvetica').fontSize(10).fillColor('#182420')
    .text(
      `We are pleased to offer you a fixed-term appointment as ${ctx.roleLabel} in the Academic Support Services department (FYE Programme).`,
      { width }
    );

  doc.moveDown(0.6);
  doc.text(
    `The period of employment will be from ${formatDateShort(ctx.periodStart)} to ${formatDateShort(ctx.periodEnd)}.`,
    { width }
  );

  doc.moveDown(0.6);
  doc.text('Reporting Line: Academic Staff Development Professional');
  doc.text(`Rate of claim: ${rateText}`);
  if (u.module_name) {
    doc.text(`Assigned module: ${[u.module_code, u.module_name].filter(Boolean).join(' — ')}`);
  }

  doc.moveDown(0.8);
  doc.text(
    'UMP would like to welcome you as a valued member of staff. Kindly notify us in writing of your acceptance of the appointment by completing the attached ACCEPTANCE OF OFFER and returning it to the Academic Support Services email: Mabizweni.machava@ump.ac.za within 10 working days upon receipt of this offer letter.',
    { width }
  );

  doc.moveDown(1.2);
  doc.text('Yours faithfully,');
  doc.moveDown(1.5);
  doc.font('Helvetica-Bold').text(dash(ctx.directorName));
  doc.font('Helvetica').text(dash(ctx.directorTitle));

  doc.addPage();
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#152e2c')
    .text('ACCEPTANCE OF OFFER', left, 54, { width, align: 'center' });

  doc.moveDown(1.2);
  doc.font('Helvetica').fontSize(10).fillColor('#182420')
    .text(
      `I, ${dash(ctx.fullName)}, hereby wish to confirm that I accept the employment offer as a ${ctx.roleLabel} in the Academic Support Services department (FYE Programme) with effect from ${formatDateShort(ctx.periodStart)}.`,
      { width }
    );

  doc.moveDown(1.5);
  doc.text('SIGNED: _______________________________          DATE: _______________');
  doc.moveDown(1.2);
  doc.text('WITNESS 1: _______________________________');
  doc.moveDown(1.0);
  doc.text('WITNESS 2: _______________________________');

  doc.moveDown(2);
  doc.font('Helvetica').fontSize(8).fillColor('#5b6864')
    .text(
      'Mbombela Campus (Main Campus)\nUniversity of Mpumalanga, Private Bag X11283, Mbombela, 1200\nc/o D725 and R40, Riverside, Mbombela, South Africa, 1200\nTel: +27 13 002 0001 · Email: info@ump.ac.za · Web: www.ump.ac.za',
      { width, align: 'center' }
    );

  doc.end();
  return done;
}

async function generateHrFormPdf(pool, userId, kind) {
  const ctx = await loadHrFormContext(pool, userId);
  if (kind === 'appointment-form-d') {
    const buffer = await buildAppointmentFormDPdf(ctx);
    return {
      buffer,
      filename: `Appointment-Form-D-${(ctx.user.surname || 'tutor').replace(/\s+/g, '-')}.pdf`,
      contentType: 'application/pdf',
    };
  }
  if (kind === 'confirmation-form' || kind === 'acceptance-letter') {
    const buffer = await buildAcceptanceLetterPdf(ctx);
    return {
      buffer,
      filename: `Acceptance-Letter-${(ctx.user.surname || 'tutor').replace(/\s+/g, '-')}.pdf`,
      contentType: 'application/pdf',
    };
  }
  const err = new Error('Unknown HR form type.');
  err.status = 404;
  throw err;
}

module.exports = {
  generateHrFormPdf,
  loadHrFormContext,
};
