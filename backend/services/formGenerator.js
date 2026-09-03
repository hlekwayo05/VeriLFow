'use strict';

const puppeteer = require('puppeteer');

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatZaDate(value) {
  if (!value) return '-';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function appointeeFullName(application) {
  return `${application.first_names || ''} ${application.surname || ''}`.trim();
}

function appointeeSignatureBlocks(application) {
  const name = appointeeFullName(application);
  if (application.offer_accepted_at) {
    return `
  <div class="sig-block">
    <div class="sig-label">Signed</div>
    <div class="sig-filled">${escapeHtml(name)}</div>
    <div class="sig-sub">Accepted electronically in VeriFlow</div>
  </div>
  <div class="sig-block">
    <div class="sig-label">Date</div>
    <div class="sig-filled">${escapeHtml(formatZaDate(application.offer_accepted_at))}</div>
  </div>`;
  }
  return `
  <div class="sig-block">
    <div class="sig-label">Signed</div>
    <div class="sig-line"></div>
    <div class="sig-sub">${escapeHtml(name)}</div>
  </div>
  <div class="sig-block">
    <div class="sig-label">Date</div>
    <div class="sig-line"></div>
  </div>`;
}

async function generateAppointmentFormD({
  application,
  settings,
}) {
  const startDate = settings.appointment_start_date
    ? new Date(settings.appointment_start_date)
      .toLocaleDateString('en-ZA', {
        day: 'numeric', month: 'long', year: 'numeric'
      })
    : '-';
  const endDate = settings.appointment_end_date
    ? new Date(settings.appointment_end_date)
      .toLocaleDateString('en-ZA', {
        day: 'numeric', month: 'long', year: 'numeric'
      })
    : '-';

  const approver = application.cost_centre === 'ucdg'
    ? (settings.ucdg_approver_name || 'Mr. Machava')
    : (settings.school_approver_name || 'Prof. Wayi');

  const qualDisplay = {
    '3rd_year':         '3rd Year Student',
    '4th_year_honours': '4th Year / Honours',
    'masters':          'Masters Student',
    'masters_holder':   'Masters Holder',
    'phd':              'PhD Candidate or Holder',
  };

  const respDisplay = {
    standard: 'Low',
    senior:   'Medium',
    lead:     'High',
  };

  const rateTable = {
    '3rd_year':         { standard: 59.66 },
    '4th_year_honours': { standard: 73.87 },
    'masters':          { standard: 90.92 },
    'masters_holder':   {
      standard: 102.28, senior: 110.80, lead: 119.33
    },
    'phd':              {
      standard: 110.80, senior: 119.33, lead: 127.84
    },
  };

  const hourlyRate = rateTable[
    application.qualification_level
  ]?.[application.responsibility_level] || '-';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Arial, sans-serif;
    font-size: 11px;
    color: #000;
    padding: 30mm 25mm;
  }
  h1 {
    font-size: 14px;
    text-align: center;
    margin-bottom: 6px;
    text-transform: uppercase;
  }
  h2 {
    font-size: 12px;
    text-align: center;
    margin-bottom: 20px;
    border-bottom: 2px solid #000;
    padding-bottom: 8px;
  }
  .note {
    background: #f5f5f5;
    border: 1px solid #ccc;
    padding: 8px 10px;
    margin-bottom: 16px;
    font-style: italic;
    font-size: 10px;
  }
  .field-row {
    display: flex;
    align-items: flex-end;
    margin-bottom: 10px;
    gap: 8px;
  }
  .field-label {
    font-weight: bold;
    white-space: nowrap;
    min-width: 140px;
  }
  .field-value {
    border-bottom: 1px solid #000;
    flex: 1;
    min-height: 18px;
    padding-bottom: 2px;
  }
  .field-row-inline {
    display: flex;
    gap: 20px;
    margin-bottom: 10px;
  }
  .field-row-inline .field-row {
    flex: 1;
    margin-bottom: 0;
  }
  .section {
    margin-top: 20px;
    margin-bottom: 10px;
    font-weight: bold;
    font-size: 11px;
    text-transform: uppercase;
    border-bottom: 1px solid #000;
    padding-bottom: 4px;
  }
  .signature-row {
    display: flex;
    gap: 40px;
    margin-top: 16px;
  }
  .sig-block {
    flex: 1;
  }
  .sig-label {
    font-weight: bold;
    margin-bottom: 4px;
    font-size: 10px;
  }
  .sig-line {
    border-bottom: 1px solid #000;
    min-height: 32px;
    margin-bottom: 4px;
  }
  .sig-filled {
    border-bottom: 1px solid #000;
    min-height: 32px;
    margin-bottom: 4px;
    padding-top: 10px;
    font-weight: bold;
  }
  .sig-sub {
    font-size: 9px;
    color: #666;
  }
  .supporting-docs {
    margin-top: 16px;
    font-size: 10px;
  }
  .supporting-docs ul {
    margin-left: 20px;
    margin-top: 4px;
  }
  .supporting-docs li {
    margin-bottom: 3px;
  }
  .institutional-box {
    border: 1px solid #000;
    padding: 12px;
    margin-top: 20px;
  }
  .institutional-title {
    font-weight: bold;
    margin-bottom: 10px;
    font-size: 11px;
  }
  @media print {
    body { padding: 0; }
  }
</style>
</head>
<body>

<h1>University of Mpumalanga</h1>
<h2>Appointment Form D - Consultant / Tutor /
Demonstrator</h2>

<div class="note">
  Note: This form has been pre-filled by the Student
  Employment Office using information captured in
  VeriFlow. Please review all details before signing.
</div>

<div class="field-row">
  <span class="field-label">Surname:</span>
  <span class="field-value">
    ${application.surname || ''}
  </span>
</div>

<div class="field-row-inline">
  <div class="field-row">
    <span class="field-label">Title:</span>
    <span class="field-value">
      ${application.title || ''}
    </span>
  </div>
  <div class="field-row">
    <span class="field-label">Initials:</span>
    <span class="field-value">
      ${application.initials || ''}
    </span>
  </div>
</div>

<div class="field-row">
  <span class="field-label">First Names:</span>
  <span class="field-value">
    ${application.first_names || ''}
  </span>
</div>

<div class="field-row">
  <span class="field-label">Identity Number:</span>
  <span class="field-value">
    ${application.id_number || ''}
  </span>
</div>

<div class="field-row">
  <span class="field-label">
    Duration of Appointment:
  </span>
  <span class="field-value">
    ${startDate} to ${endDate}
  </span>
</div>

<div class="section">Address Details</div>

<div class="field-row">
  <span class="field-label">Postal Address:</span>
  <span class="field-value">
    ${application.postal_street || ''}
    ${application.postal_city || ''}
  </span>
</div>
<div class="field-row">
  <span class="field-label">Code:</span>
  <span class="field-value" style="max-width:120px;">
    ${application.postal_code || ''}
  </span>
</div>

<div class="field-row">
  <span class="field-label">
    Residential Address:
  </span>
  <span class="field-value">
    ${application.residential_same_as_postal
      ? (application.postal_street || '') + ' ' +
        (application.postal_city || '')
      : (application.residential_street || '') + ' ' +
        (application.residential_city || '')}
  </span>
</div>
<div class="field-row">
  <span class="field-label">Code:</span>
  <span class="field-value" style="max-width:120px;">
    ${application.residential_same_as_postal
      ? (application.postal_code || '')
      : (application.residential_postal_code || '')}
  </span>
</div>

<div class="section">Contact and Financial Details</div>

<div class="field-row">
  <span class="field-label">Email Address:</span>
  <span class="field-value">
    ${application.email || ''}
  </span>
</div>

<div class="field-row">
  <span class="field-label">Cellular Phone:</span>
  <span class="field-value">
    ${application.cell || ''}
  </span>
</div>

<div class="field-row-inline">
  <div class="field-row">
    <span class="field-label">Bank Name:</span>
    <span class="field-value">
      ${application.bank || ''}
    </span>
  </div>
  <div class="field-row">
    <span class="field-label">Branch Code:</span>
    <span class="field-value">
      ${application.branch || ''}
    </span>
  </div>
</div>

<div class="field-row">
  <span class="field-label">Account Number:</span>
  <span class="field-value">
    ${application.accnum || ''}
  </span>
</div>

<div class="field-row">
  <span class="field-label">
    Account Holder Name:
  </span>
  <span class="field-value">
    ${application.accholder || ''}
  </span>
</div>

<div class="field-row">
  <span class="field-label">
    Income Tax Number:
  </span>
  <span class="field-value">
    ${application.taxnum || ''}
  </span>
</div>

<div class="field-row">
  <span class="field-label">Pay Rate:</span>
  <span class="field-value">
    R${hourlyRate}/hr -
    ${qualDisplay[application.qualification_level]
      || application.qualification_level}
    (${respDisplay[application.responsibility_level]
      || application.responsibility_level}
    responsibility)
  </span>
</div>

<div class="section">
  Signature and Declaration
</div>

<div class="signature-row">
  ${appointeeSignatureBlocks(application)}
</div>

<div class="institutional-box">
  <div class="institutional-title">
    Institutional Approval
  </div>
  <div class="field-row">
    <span class="field-label">Approved by:</span>
    <span class="field-value">${approver}</span>
  </div>
  <div class="signature-row">
    <div class="sig-block">
      <div class="sig-label">Signature</div>
      <div class="sig-line"></div>
    </div>
    <div class="sig-block">
      <div class="sig-label">Date</div>
      <div class="sig-line"></div>
    </div>
  </div>
  <div class="institutional-title"
    style="margin-top:16px;">
    HR Confirmation
  </div>
  <div class="field-row">
    <span class="field-label">
      HR Data Captured by:
    </span>
    <span class="field-value"></span>
  </div>
  <div class="signature-row">
    <div class="sig-block">
      <div class="sig-label">Signature</div>
      <div class="sig-line"></div>
    </div>
    <div class="sig-block">
      <div class="sig-label">Date</div>
      <div class="sig-line"></div>
    </div>
  </div>
</div>

<div style="margin-top:16px;font-size:9px;
  color:#999;text-align:center;">
  Generated by VeriFlow · University of Mpumalanga ·
  ${new Date().toLocaleDateString('en-ZA')}
</div>

</body>
</html>`;

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, {
      waitUntil: 'networkidle0'
    });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '10mm', bottom: '10mm',
        left: '0mm', right: '0mm',
      },
    });
    return pdf;
  } finally {
    await browser.close();
  }
}

async function generateConfirmationForm({
  application,
  settings,
}) {
  const startDate = settings.appointment_start_date
    ? new Date(settings.appointment_start_date)
      .toLocaleDateString('en-ZA', {
        day: 'numeric', month: 'long', year: 'numeric'
      })
    : '01 February 2026';
  const endDate = settings.appointment_end_date
    ? new Date(settings.appointment_end_date)
      .toLocaleDateString('en-ZA', {
        day: 'numeric', month: 'long', year: 'numeric'
      })
    : '31 December 2026';

  const rateTable = {
    '3rd_year':         { standard: 59.66 },
    '4th_year_honours': { standard: 73.87 },
    'masters':          { standard: 90.92 },
    'masters_holder':   {
      standard: 102.28, senior: 110.80, lead: 119.33
    },
    'phd':              {
      standard: 110.80, senior: 119.33, lead: 127.84
    },
  };

  const hourlyRate = rateTable[
    application.qualification_level
  ]?.[application.responsibility_level] || '-';

  const positionLabel =
    application.position_type === 'demonstrator'
      ? 'Demonstrator'
      : 'Tutor';

  const directorName = settings.director_name ||
    'Dr M Madiope';
  const directorTitle = settings.director_title ||
    'Director: Academic Support Services Division';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Arial, sans-serif;
    font-size: 11px;
    color: #000;
    padding: 30mm 25mm;
  }
  .header {
    text-align: right;
    margin-bottom: 24px;
    font-size: 10px;
    color: #666;
  }
  .confidential {
    font-weight: bold;
    text-align: center;
    margin-bottom: 16px;
    font-size: 10px;
    letter-spacing: 1px;
  }
  .salutation { margin-bottom: 16px; }
  .subject {
    font-weight: bold;
    text-decoration: underline;
    margin-bottom: 16px;
    font-size: 11px;
    text-transform: uppercase;
  }
  .body-text {
    line-height: 1.7;
    margin-bottom: 12px;
  }
  .sign-off { margin-top: 32px; }
  .director-name {
    font-weight: bold;
    margin-top: 8px;
  }
  .director-title {
    font-size: 10px;
    color: #444;
  }
  .acceptance {
    margin-top: 40px;
    border-top: 2px solid #000;
    padding-top: 16px;
  }
  .acceptance-title {
    font-weight: bold;
    text-align: center;
    margin-bottom: 16px;
    font-size: 12px;
    text-transform: uppercase;
  }
  .acceptance-text {
    line-height: 1.7;
    margin-bottom: 20px;
  }
  .signature-row {
    display: flex;
    gap: 40px;
    margin-top: 24px;
  }
  .sig-block { flex: 1; }
  .sig-label {
    font-weight: bold;
    margin-bottom: 4px;
    font-size: 10px;
  }
  .sig-line {
    border-bottom: 1px solid #000;
    min-height: 32px;
    margin-bottom: 4px;
  }
  .sig-filled {
    border-bottom: 1px solid #000;
    min-height: 32px;
    margin-bottom: 4px;
    padding-top: 10px;
    font-weight: bold;
  }
  .witness-row {
    display: flex;
    gap: 40px;
    margin-top: 20px;
  }
</style>
</head>
<body>

<div class="header">
  ${new Date().toLocaleDateString('en-ZA', {
    day: 'numeric', month: 'long', year: 'numeric'
  })}
</div>

<div class="confidential">PERSONAL AND CONFIDENTIAL</div>

<div class="salutation">
  Dear ${application.first_names || ''} 
  ${application.surname || ''},
</div>

<div class="subject">
  Appointment as a ${positionLabel} in the Academic
  Support Services Department
</div>

<div class="body-text">
  We are pleased to offer you a one-year appointment
  as <strong>${positionLabel}</strong> in the Academic
  Support Services department.
</div>

<div class="body-text">
  The period of employment will be from
  <strong>${startDate}</strong> to
  <strong>${endDate}</strong>.
</div>

<div class="body-text">
  <strong>Reporting Line:</strong> Academic Staff
  Development Professional
</div>

<div class="body-text">
  <strong>Rate of claim:</strong>
  R${hourlyRate} per hour
  (Rate based on level of study)
</div>

<div class="body-text">
  UMP would like to welcome you as a valued member
  of staff. Kindly accept this appointment in
  VeriFlow by selecting I accept on your profile
  within 10 working days of this offer. Your
  authenticated login records your signature on the
  appointment forms.
</div>

<div class="sign-off">
  Yours faithfully,
  <div class="signature-row">
    <div class="sig-block">
      <div class="sig-line"></div>
      <div class="director-name">${directorName}</div>
      <div class="director-title">
        ${directorTitle}
      </div>
    </div>
  </div>
</div>

<div class="acceptance">
  <div class="acceptance-title">
    Acceptance of Offer
  </div>

  <div class="acceptance-text">
    I <span style="border-bottom:1px solid #000;
      display:inline-block;min-width:200px;">
      ${application.first_names || ''}
      ${application.surname || ''}
    </span>
    (Full Name), hereby wish to confirm that I accept
    the employment offer as a ${positionLabel} in
    the Academic Support Services department with
    effect from <strong>${startDate}</strong>.
  </div>

  <div class="signature-row">
    ${appointeeSignatureBlocks(application)}
  </div>
</div>

<div style="margin-top:24px;font-size:9px;
  color:#999;text-align:center;">
  Generated by VeriFlow · University of Mpumalanga ·
  ${new Date().toLocaleDateString('en-ZA')}
</div>

</body>
</html>`;

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, {
      waitUntil: 'networkidle0'
    });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '0mm', bottom: '0mm',
        left: '0mm', right: '0mm',
      },
    });
    return pdf;
  } finally {
    await browser.close();
  }
}

module.exports = {
  generateAppointmentFormD,
  generateConfirmationForm,
};
