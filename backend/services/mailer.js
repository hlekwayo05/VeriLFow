'use strict';

const pool       = require('../db');
const { getAppSettings } = require('./settings');

function resolveEmailRecipient(realEmail, realSubject) {
  const override = process.env.EMAIL_OVERRIDE;
  if (override && override.trim()) {
    return {
      to: override.trim(),
      subject: `[TEST → ${realEmail}] ${realSubject}`,
    };
  }
  return {
    to: realEmail,
    subject: realSubject,
  };
}

const MONTHS = [  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const GREEN = '#76B9A8';
const DARK  = '#2B5259';
const MUTED = '#6B8289';

function parseClosingDateValue(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const str = String(value).trim();
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const date = new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(str);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatClosingDate(value) {
  const date = parseClosingDateValue(value);
  if (!date) return 'TBC';
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${day} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function buildEmailBody(template, closingDate, portalLink) {
  return String(template || '')
    .replace(/\{closing_date\}/g, closingDate)
    .replace(/\{portal_link\}/g, portalLink);
}

function isCustomMessage(body) {
  if (!body || !String(body).trim()) return false;
  const trimmed = String(body).trim();
  const defaultStart = 'Dear Students,';
  const defaultStart2 = 'Applications are now open';
  return !trimmed.startsWith(defaultStart) &&
    !trimmed.startsWith(defaultStart2);
}

function formatAnnouncementClosingDate(closingDate) {
  const date = parseClosingDateValue(closingDate);
  if (!date) return 'To be confirmed';
  return date.toLocaleDateString('en-ZA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function buildAnnouncementHtml({
  firstName,
  closingDate,
  portalLink,
  customMessage,
}) {
  const closing = formatAnnouncementClosingDate(closingDate);
  const safeName = escapeHtml(firstName || 'Student');
  const safeLink = escapeHtml(portalLink || '');
  const safeClosing = escapeHtml(closing);

  const custom = customMessage
    ? `<tr><td style="padding:0 40px 24px;">
        <p style="margin:0;font-size:15px;line-height:1.6;color:#333;">${customMessage}</p>
       </td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Tutor Applications Open — VeriFlow</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 20px;">
  <tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

    <tr>
      <td style="background:${DARK};padding:28px 40px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:22px;font-weight:800;color:#ffffff;letter-spacing:3px;">VERIFLOW</div>
              <div style="font-size:11px;color:#888888;margin-top:3px;letter-spacing:1px;">STUDENT EMPLOYMENT OFFICE</div>
            </td>
            <td align="right">
              <div style="font-size:12px;color:#888888;text-align:right;">University of Mpumalanga</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="background:${DARK};padding:0 40px 36px;">
        <h1 style="margin:0;font-size:28px;font-weight:700;color:#ffffff;line-height:1.2;">
          Tutor Applications<br/>
          <span style="color:${GREEN};">Now Open</span>
        </h1>
        <p style="margin:12px 0 0;font-size:14px;color:#aaaaaa;line-height:1.5;">
          2026 Academic Year &nbsp;·&nbsp; DICT &amp; BICT Programmes
        </p>
      </td>
    </tr>

    <tr>
      <td style="padding:32px 40px 8px;">
        <p style="margin:0;font-size:16px;color:${DARK};font-weight:600;">Dear ${safeName},</p>
        <p style="margin:12px 0 0;font-size:15px;line-height:1.7;color:#444444;">
          Applications are now open for <strong>Tutor positions</strong> for the 2026 academic year at the
          University of Mpumalanga. We are looking for senior students to support their peers
          across DICT and BICT programmes.
        </p>
      </td>
    </tr>

    ${custom}

    <tr>
      <td style="padding:8px 40px;">
        <hr style="border:none;border-top:1px solid #eeeeee;margin:0;"/>
      </td>
    </tr>

    <tr>
      <td style="padding:24px 40px 8px;">
        <h2 style="margin:0 0 12px;font-size:12px;font-weight:700;color:${GREEN};text-transform:uppercase;letter-spacing:2px;">What You Will Do</h2>
        <table cellpadding="0" cellspacing="0" width="100%">
          ${[
            'Conduct tutorial, practical, and revision sessions',
            'Support students with coursework and assignments',
            'Log attendance and submit monthly timesheets',
            'Work closely with your module lecturer',
            'Provide academic guidance and peer support',
          ].map((item) => `
          <tr>
            <td width="20" style="vertical-align:top;padding:4px 0;">
              <span style="color:${GREEN};font-size:16px;">•</span>
            </td>
            <td style="padding:4px 0;font-size:14px;color:#444444;line-height:1.5;">${item}</td>
          </tr>`).join('')}
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding:24px 40px 8px;">
        <h2 style="margin:0 0 12px;font-size:12px;font-weight:700;color:${GREEN};text-transform:uppercase;letter-spacing:2px;">What You Need</h2>
        <table cellpadding="0" cellspacing="0" width="100%">
          ${[
            'Minimum 75% academic average',
            'Must have passed the module you want to tutor',
            'Good communication and interpersonal skills',
            'Ability to work independently and in a team',
            'Highly motivated and committed to student success',
          ].map((item) => `
          <tr>
            <td width="20" style="vertical-align:top;padding:4px 0;">
              <span style="color:${GREEN};font-size:16px;">•</span>
            </td>
            <td style="padding:4px 0;font-size:14px;color:#444444;line-height:1.5;">${item}</td>
          </tr>`).join('')}
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding:24px 40px 8px;">
        <h2 style="margin:0 0 12px;font-size:12px;font-weight:700;color:${GREEN};text-transform:uppercase;letter-spacing:2px;">Benefits</h2>
        <table cellpadding="0" cellspacing="0" width="100%">
          ${[
            'Stipend for sessions conducted',
            'Skills development — communication, leadership, and mentoring',
            'Teaching and academic experience',
            'Increased confidence and professional growth',
          ].map((item) => `
          <tr>
            <td width="20" style="vertical-align:top;padding:4px 0;">
              <span style="color:${GREEN};font-size:16px;">•</span>
            </td>
            <td style="padding:4px 0;font-size:14px;color:#444444;line-height:1.5;">${item}</td>
          </tr>`).join('')}
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding:24px 40px 0;">
        <hr style="border:none;border-top:1px solid #eeeeee;margin:0;"/>
      </td>
    </tr>

    <tr>
      <td style="padding:32px 40px;text-align:center;">
        <p style="margin:0 0 24px;font-size:15px;color:#444444;line-height:1.6;">
          Click the button below to complete your application on the VeriFlow portal.
          You will need to upload your <strong>CV</strong> and <strong>academic record</strong>.
        </p>
        <a href="${safeLink}" style="display:inline-block;background:${DARK};color:#ffffff;font-size:14px;font-weight:700;padding:14px 36px;border-radius:8px;text-decoration:none;letter-spacing:1px;">APPLY NOW ON VERIFLOW →</a>
        <p style="margin:24px 0 0;font-size:13px;color:#888888;">
          Closing date: <strong style="color:${DARK};">${safeClosing}</strong>
        </p>
      </td>
    </tr>

    <tr>
      <td style="padding:0 40px;">
        <hr style="border:none;border-top:1px solid #eeeeee;margin:0;"/>
      </td>
    </tr>

    <tr>
      <td style="padding:24px 40px 32px;">
        <p style="margin:0;font-size:14px;color:#444444;line-height:1.7;">
          Kind regards,<br/>
          <strong>Student Employment Office</strong><br/>
          University of Mpumalanga
        </p>
      </td>
    </tr>

    <tr>
      <td style="background:#f8f8f8;padding:20px 40px;border-top:1px solid #eeeeee;">
        <p style="margin:0;font-size:11px;color:#aaaaaa;line-height:1.6;text-align:center;">
          This email was sent via VeriFlow — the Student Employment Management System at the University of Mpumalanga.<br/>
          You are receiving this because you are registered as a student at UMP.
        </p>
      </td>
    </tr>

  </table>
  </td></tr>
</table>

</body>
</html>`;
}

function createResendClient() {
  try {
    const { Resend } = require('resend');
    return new Resend(process.env.RESEND_API_KEY);
  } catch (err) {
    console.warn('Resend package not available — run npm install in backend/:', err.message);
    return null;
  }
}

function referralLoginLink() {
  const base = (process.env.FRONTEND_URL || 'http://localhost:5500/frontend').replace(/\/$/, '');
  return `${base}/pages/login.html`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function emailHeaderHtml() {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:${DARK};">
      <tr>
        <td align="center" style="padding:28px 24px;">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;letter-spacing:3px;color:#ffffff;">VERIFLOW</div>
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1.5px;color:#9ca3af;margin-top:6px;text-transform:uppercase;">Student Employment Office</div>
        </td>
      </tr>
    </table>`;
}

function emailFooterHtml() {
  return `
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:24px 32px 8px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#374151;">
          Kind regards,<br/>
          Student Employment Office<br/>
          University of Mpumalanga
        </td>
      </tr>
      <tr>
        <td style="padding:8px 32px 28px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;color:${MUTED};">
          VeriFlow — Accurate. Timely. Transparent.<br/>
          University of Mpumalanga · Student Employment Office
        </td>
      </tr>
    </table>`;
}

function wrapEmailHtml(bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f4f4f5;">
  ${emailHeaderHtml()}
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;max-width:600px;margin:0 auto;">
    <tr><td style="padding:32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:#1f2937;">
      ${bodyHtml}
    </td></tr>
  </table>
  ${emailFooterHtml()}
</body>
</html>`;
}

function buildReferralNotificationHtml({
  studentFirstName,
  lecturerName,
  moduleCode,
  moduleName,
}) {
  const moduleLabel = moduleName
    ? `${escapeHtml(moduleCode)} — ${escapeHtml(moduleName)}`
    : escapeHtml(moduleCode);

  const body = `
    <p style="margin:0 0 16px;">Dear ${escapeHtml(studentFirstName)},</p>
    <p style="margin:0 0 16px;">
      <strong>${escapeHtml(lecturerName)}</strong> has referred you for a Tutor position
      for <strong>${moduleLabel}</strong> at the University of Mpumalanga.
    </p>
    <p style="margin:0 0 16px;">
      Your application is currently under review by the Student Employment Office.
      You will be notified by email once a decision has been made.
    </p>
    <p style="margin:0 0 16px;padding:14px 16px;background:#f9fafb;border-left:3px solid ${GREEN};color:#4b5563;font-size:14px;">
      No action is required from you at this stage.
    </p>`;

  return wrapEmailHtml(body);
}

function buildReferralApprovalHtml({
  studentFirstName,
  moduleCode,
  moduleName,
  tempPassword,
  loginLink,
  studentEmail,
}) {
  const moduleLabel = moduleName
    ? `${escapeHtml(moduleCode)} — ${escapeHtml(moduleName)}`
    : escapeHtml(moduleCode);

  const body = `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:-32px -32px 24px;background:${DARK};">
      <tr>
        <td style="padding:28px 32px;font-family:Arial,Helvetica,sans-serif;">
          <div style="font-size:26px;font-weight:700;color:#ffffff;margin-bottom:6px;">Congratulations, ${escapeHtml(studentFirstName)}!</div>
          <div style="font-size:15px;color:${GREEN};">Your Tutor application has been approved</div>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 16px;">
      You have been approved as a Tutor for <strong>${moduleLabel}</strong>
      at the University of Mpumalanga.
    </p>
    <p style="margin:0 0 20px;">
      Your temporary login details are below. Please log in and change your password immediately.
    </p>
    <div style="margin:0 0 24px;padding:18px 20px;background:#f3f4f6;border-radius:8px;font-family:Consolas,'Courier New',monospace;font-size:14px;line-height:1.8;color:#111827;">
      <div><span style="color:${MUTED};">Email:</span> ${escapeHtml(studentEmail)}</div>
      <div><span style="color:${MUTED};">Temporary password:</span> <strong>${escapeHtml(tempPassword)}</strong></div>
    </div>
    <p style="margin:0 0 10px;font-size:13px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#374151;">What happens next</p>
    <ol style="margin:0 0 24px;padding-left:20px;color:#374151;line-height:1.8;">
      <li>Click the button below to go to VeriFlow</li>
      <li>Log in with your email and temporary password</li>
      <li>Change your password when prompted</li>
      <li>Complete your personal details (onboarding)</li>
      <li>Complete your banking and tax details</li>
      <li>Access your Tutor dashboard</li>
    </ol>
    <p style="margin:0 0 24px;text-align:center;">
      <a href="${escapeHtml(loginLink)}" style="display:inline-block;padding:14px 28px;background:${DARK};color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:1px;border-radius:6px;">LOG IN TO VERIFLOW →</a>
    </p>
    <p style="margin:0;font-size:12px;line-height:1.6;color:${MUTED};">
      For your security, please change your temporary password immediately after logging in.
      Do not share your login details with anyone.
    </p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f4f4f5;">
  ${emailHeaderHtml()}
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;max-width:600px;margin:0 auto;">
    <tr><td style="padding:32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:#1f2937;">
      ${body}
    </td></tr>
  </table>
  ${emailFooterHtml()}
</body>
</html>`;
}

function buildReferralApprovalNoPasswordHtml({
  studentFirstName,
  moduleCode,
  moduleName,
  loginLink,
}) {
  const moduleLabel = moduleName
    ? `${escapeHtml(moduleCode)} — ${escapeHtml(moduleName)}`
    : escapeHtml(moduleCode);

  const body = `
    <p style="margin:0 0 16px;">Dear ${escapeHtml(studentFirstName)},</p>
    <p style="margin:0 0 16px;">
      Your application for a Tutor position for <strong>${moduleLabel}</strong>
      at the University of Mpumalanga has been approved by the Student Employment Office.
    </p>
    <p style="margin:0 0 24px;">
      Log in to VeriFlow with your existing account to access your Tutor dashboard and complete any remaining onboarding steps.
    </p>
    <p style="margin:0 0 24px;text-align:center;">
      <a href="${escapeHtml(loginLink)}" style="display:inline-block;padding:14px 28px;background:${DARK};color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:1px;border-radius:6px;">LOG IN TO VERIFLOW →</a>
    </p>`;

  return wrapEmailHtml(body);
}

function credentialsBoxHtml(email, tempPassword) {
  return `
    <div style="margin:0 0 24px;padding:18px 20px;background:#f3f4f6;border-radius:8px;font-family:Consolas,'Courier New',monospace;font-size:14px;line-height:1.8;color:#111827;">
      <div><span style="color:${MUTED};">Email:</span> ${escapeHtml(email)}</div>
      <div><span style="color:${MUTED};">Temporary password:</span> <strong>${escapeHtml(tempPassword)}</strong></div>
    </div>`;
}

function loginButtonHtml(loginLink) {
  return `
    <p style="margin:0 0 24px;text-align:center;">
      <a href="${escapeHtml(loginLink)}" style="display:inline-block;padding:14px 28px;background:${DARK};color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:1px;border-radius:6px;">LOG IN TO VERIFLOW →</a>
    </p>`;
}

function heroEmailShell(heroHtml, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f4f4f5;">
  ${emailHeaderHtml()}
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;max-width:600px;margin:0 auto;">
    <tr><td style="padding:32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:#1f2937;">
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:-32px -32px 24px;background:${DARK};">
        <tr>
          <td style="padding:28px 32px;font-family:Arial,Helvetica,sans-serif;">
            ${heroHtml}
          </td>
        </tr>
      </table>
      ${bodyHtml}
    </td></tr>
  </table>
  ${emailFooterHtml()}
</body>
</html>`;
}

function buildLecturerWelcomeHtml({
  lecturerFirstName,
  lecturerEmail,
  tempPassword,
  modules,
  loginLink,
}) {
  const moduleRows = (modules && modules.length)
    ? modules.map((m) => `
        <div style="margin:0 0 10px;padding:12px 14px;background:#f9fafb;border-radius:6px;border:1px solid #e5e7eb;">
          <strong>${escapeHtml(m.code)}</strong> — ${escapeHtml(m.name)}<br/>
          <span style="font-size:13px;color:${MUTED};">(Course: ${escapeHtml(m.course || '—')})</span>
        </div>`).join('')
    : `<p style="margin:0;color:#4b5563;font-size:14px;">Your modules will be assigned by the coordinator.</p>`;

  const heroHtml = `
    <div style="font-size:26px;font-weight:700;color:#ffffff;margin-bottom:6px;">Welcome to VeriFlow, ${escapeHtml(lecturerFirstName)}!</div>
    <div style="font-size:15px;color:${GREEN};">Your lecturer account is ready</div>`;

  const bodyHtml = `
    <p style="margin:0 0 16px;">
      Your VeriFlow account has been created by the Student Employment Office
      at the University of Mpumalanga.
    </p>
    <p style="margin:0 0 24px;">
      VeriFlow is the tutor management system used to schedule sessions, manage tutor attendance,
      and process monthly tutor claims for your module(s).
    </p>
    <h2 style="margin:0 0 12px;font-size:13px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:${GREEN};">
      Your Assigned Module(s)
    </h2>
    <div style="margin:0 0 24px;">
      ${moduleRows}
    </div>
    <p style="margin:0 0 12px;">
      Your temporary login details are below. Please log in and change your password immediately.
    </p>
    ${credentialsBoxHtml(lecturerEmail, tempPassword)}
    <p style="margin:0 0 10px;font-size:13px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#374151;">What happens next</p>
    <ol style="margin:0 0 24px;padding-left:20px;color:#374151;line-height:1.8;">
      <li>Click the button below to go to VeriFlow</li>
      <li>Log in with your email and temporary password</li>
      <li>Change your password when prompted</li>
      <li>You will be taken to your Lecturer dashboard</li>
      <li>From your dashboard you can schedule sessions, view your tutors, and manage claims</li>
    </ol>
    ${loginButtonHtml(loginLink)}
    <p style="margin:0;font-size:12px;line-height:1.6;color:${MUTED};">
      For your security, you will be required to change your temporary password on first login.
      Do not share your login details with anyone.
    </p>`;

  return heroEmailShell(heroHtml, bodyHtml);
}

function buildPasswordResetHtml({
  userFirstName,
  userEmail,
  tempPassword,
  loginLink,
  roleLabel,
}) {
  const heroHtml = `
    <div style="font-size:26px;font-weight:700;color:#ffffff;margin-bottom:6px;">Password Reset</div>
    <div style="font-size:15px;color:${GREEN};">Your temporary password is ready</div>`;

  const bodyHtml = `
    <p style="margin:0 0 16px;">Dear ${escapeHtml(userFirstName)},</p>
    <p style="margin:0 0 16px;">
      Your VeriFlow password has been reset by the Student Employment Office.
    </p>
    <p style="margin:0 0 20px;">
      Use the temporary password below to log in as a <strong>${escapeHtml(roleLabel)}</strong>.
      You will be required to change it immediately.
    </p>
    ${credentialsBoxHtml(userEmail, tempPassword)}
    ${loginButtonHtml(loginLink)}
    <p style="margin:0;font-size:12px;line-height:1.6;color:${MUTED};">
      Please change your temporary password immediately after logging in.
      Do not share your login details with anyone.
    </p>`;

  return heroEmailShell(heroHtml, bodyHtml);
}

async function sendResendEmail({ to, subject, html, text }) {
  if (!to) {
    throw new Error(`Email skipped — no recipient (${subject})`);
  }
  if (!process.env.RESEND_API_KEY) {
    throw new Error(
      `Email skipped (no RESEND_API_KEY in backend/.env): ${subject} → ${to}`
    );
  }

  const resend = createResendClient();
  if (!resend) {
    throw new Error('Resend client unavailable — run npm install in backend/');
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
  const realEmail = to;
  const recipient = resolveEmailRecipient(realEmail, subject);

  const { data, error } = await resend.emails.send({
    from: fromEmail,
    to: recipient.to,
    subject: recipient.subject,
    html,
    text,
  });

  if (error) {
    const detail = error.message || JSON.stringify(error);
    throw new Error(`Resend rejected email to ${recipient.to}: ${detail}`);
  }

  if (process.env.EMAIL_OVERRIDE && process.env.EMAIL_OVERRIDE.trim()) {
    console.log(
      `Email sent (override) → ${recipient.to} [intended: ${realEmail}]`
    );
  } else {
    console.log(`Email sent → ${realEmail}`);
  }

  return data;
}

async function sendAnnouncementEmail(presetSettings) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — skipping announcement emails.');
    return { sent: 0, failed: 0, skipped: true };
  }

  const portalLink = process.env.PORTAL_URL ||
    'http://localhost:5500/frontend/pages/apply-step1.html';

  let settings = presetSettings;
  if (!settings) {
    try {
      settings = await getAppSettings();
    } catch (err) {
      console.error('Could not load settings for announcement email:', err.message);
      return { sent: 0, failed: 0, error: err.message };
    }
  }

  let students;
  try {
    const result = await pool.query(
      'SELECT first_names, email FROM students ORDER BY surname ASC'
    );
    students = result.rows;
  } catch (err) {
    if (err.code === '42P01') {
      console.warn('students table not found — skipping announcement emails.');
      return { sent: 0, failed: 0, skipped: true };
    }
    console.error('Could not load students for announcement email:', err.message);
    return { sent: 0, failed: 0, error: err.message };
  }

  if (!students.length) {
    console.warn('No students in list — announcement email not sent.');
    return { sent: 0, failed: 0 };
  }

  const subject = settings.announcement_subject ||
    'Tutor Applications Now Open — 2026 Academic Year';
  const closingLabel = formatAnnouncementClosingDate(settings.closing_date);

  let customMessageHtml = null;
  if (isCustomMessage(settings.announcement_body)) {
    const processed = buildEmailBody(
      settings.announcement_body,
      closingLabel,
      portalLink
    );
    customMessageHtml = escapeHtml(processed).replace(/\n/g, '<br/>');
  }

  let sent   = 0;
  let failed = 0;

  for (const student of students) {
    const firstName = student.first_names || 'Student';

    const html = buildAnnouncementHtml({
      firstName,
      closingDate: settings.closing_date,
      portalLink,
      customMessage: customMessageHtml,
    });

    const text = `
Dear ${firstName},

Applications are now open for Tutor positions for the 2026 academic year at the University of Mpumalanga.

What you need:
- Minimum 75% academic average
- Must have passed the module you want to tutor
- Good communication skills

Benefits:
- Stipend for sessions conducted
- Skills development
- Teaching experience

Apply now: ${portalLink}

Closing date: ${closingLabel}

Kind regards,
Student Employment Office
University of Mpumalanga
    `.trim();

    try {
      await sendResendEmail({
        to: student.email,
        subject,
        text,
        html,
      });
      sent += 1;
    } catch (err) {
      failed += 1;
      console.error(`Failed to email ${student.email}:`, err.message);
    }
  }

  console.log(`Announcement emails — sent: ${sent}, failed: ${failed}`);
  return { sent, failed };
}

async function sendReferralNotificationEmail({
  studentEmail,
  studentFirstName,
  lecturerName,
  moduleCode,
  moduleName,
}) {
  const moduleLabel = moduleName ? `${moduleCode} — ${moduleName}` : moduleCode;
  const text = `
Dear ${studentFirstName},

${lecturerName} has referred you for a Tutor position for ${moduleLabel} at the University of Mpumalanga.

Your application is currently under review by the Student Employment Office. You will be notified by email once a decision has been made.

No action is required from you at this stage.

Kind regards,
Student Employment Office
University of Mpumalanga
  `.trim();

  const html = buildReferralNotificationHtml({
    studentFirstName,
    lecturerName,
    moduleCode,
    moduleName,
  });

  await sendResendEmail({
    to: studentEmail,
    subject: 'You have been referred for a Tutor position — UMP',
    html,
    text,
  });
}

async function sendReferralApprovalEmail({
  studentEmail,
  studentFirstName,
  moduleCode,
  moduleName,
  tempPassword,
  loginLink,
}) {
  const moduleLabel = moduleName ? `${moduleCode} — ${moduleName}` : moduleCode;
  const link = loginLink || referralLoginLink();

  const text = `
Dear ${studentFirstName},

Congratulations! Your application for a Tutor position for ${moduleLabel} at the University of Mpumalanga has been approved by the Student Employment Office.

Your temporary login details are below. Please log in and change your password immediately.

Login link: ${link}
Email: ${studentEmail}
Temporary password: ${tempPassword}

Once logged in you will be prompted to:
1. Change your password
2. Complete your personal details
3. Complete your banking and tax details

After onboarding is complete you will have access to your Tutor dashboard.

Kind regards,
Student Employment Office
University of Mpumalanga
  `.trim();

  const html = buildReferralApprovalHtml({
    studentFirstName,
    moduleCode,
    moduleName,
    tempPassword,
    loginLink: link,
    studentEmail,
  });

  await sendResendEmail({
    to: studentEmail,
    subject: 'Congratulations — Your Tutor Application has been Approved',
    html,
    text,
  });
}

async function sendReferralApprovalNoPasswordEmail({
  studentEmail,
  studentFirstName,
  moduleCode,
  moduleName,
  loginLink,
}) {
  const moduleLabel = moduleName ? `${moduleCode} — ${moduleName}` : moduleCode;
  const link = loginLink || referralLoginLink();

  const text = `
Dear ${studentFirstName},

Your application for a Tutor position for ${moduleLabel} at the University of Mpumalanga has been approved by the Student Employment Office.

Log in to VeriFlow with your existing account: ${link}

Kind regards,
Student Employment Office
University of Mpumalanga
  `.trim();

  const html = buildReferralApprovalNoPasswordHtml({
    studentFirstName,
    moduleCode,
    moduleName,
    loginLink: link,
  });

  await sendResendEmail({
    to: studentEmail,
    subject: 'Congratulations — Your Tutor Application has been Approved',
    html,
    text,
  });
}

async function sendLecturerWelcomeEmail({
  lecturerEmail,
  lecturerFirstName,
  tempPassword,
  modules,
  loginLink,
}) {
  const link = loginLink || referralLoginLink();
  const moduleList = (modules || [])
    .map((m) => `${m.code} — ${m.name}`)
    .join(', ') || 'To be assigned';

  const text = `
Dear ${lecturerFirstName},

Your VeriFlow account has been created by the Student Employment Office at the University of Mpumalanga.

VeriFlow is the tutor management system used to schedule sessions, manage attendance, and process tutor claims for your module(s).

Your login details are below:

Login link: ${link}
Email: ${lecturerEmail}
Temporary password: ${tempPassword}

Your assigned module(s): ${moduleList}

For your security, you will be required to change your password when you first log in.

Kind regards,
Student Employment Office
University of Mpumalanga
  `.trim();

  const html = buildLecturerWelcomeHtml({
    lecturerFirstName,
    lecturerEmail,
    tempPassword,
    modules,
    loginLink: link,
  });

  await sendResendEmail({
    to: lecturerEmail,
    subject: 'Your VeriFlow Account — University of Mpumalanga',
    html,
    text,
  });
}

async function sendPasswordResetEmail({
  userEmail,
  userFirstName,
  tempPassword,
  loginLink,
  role,
}) {
  const roleLabel = role === 'lecturer' ? 'Lecturer' : 'Tutor';
  const link = loginLink || referralLoginLink();

  const text = `
Dear ${userFirstName},

Your VeriFlow password has been reset by the Student Employment Office.

Your new temporary login details are below:

Login link: ${link}
Email: ${userEmail}
Temporary password: ${tempPassword}

Please log in and change your password immediately.

Kind regards,
Student Employment Office
University of Mpumalanga
  `.trim();

  const html = buildPasswordResetHtml({
    userFirstName,
    userEmail,
    tempPassword,
    loginLink: link,
    roleLabel,
  });

  await sendResendEmail({
    to: userEmail,
    subject: 'Your VeriFlow Password Has Been Reset — UMP',
    html,
    text,
  });
}

async function sendApplicationApprovedEmail({
  studentEmail,
  studentFirstName,
  moduleName,
}) {
  const moduleLabel = moduleName ? ` for ${moduleName}` : '';
  const text = `
Dear ${studentFirstName},

Congratulations! Your tutor application${moduleLabel} at the University of Mpumalanga has been approved by the Student Employment Office.

Log in to VeriFlow to complete onboarding and access your tutor dashboard.

Kind regards,
Student Employment Office
University of Mpumalanga
  `.trim();

  const body = `
    <p style="margin:0 0 16px;">Dear ${escapeHtml(studentFirstName)},</p>
    <p style="margin:0 0 16px;">
      Congratulations! Your tutor application${moduleLabel ? ` for <strong>${escapeHtml(moduleName)}</strong>` : ''}
      at the University of Mpumalanga has been approved by the Student Employment Office.
    </p>
    <p style="margin:0 0 16px;">
      Log in to VeriFlow to complete onboarding and access your tutor dashboard.
    </p>`;

  await sendResendEmail({
    to: studentEmail,
    subject: 'Congratulations — Your Tutor Application has been Approved',
    html: wrapEmailHtml(body),
    text,
  });
}

async function sendApplicationRejectedEmail({
  studentEmail,
  studentFirstName,
  moduleName,
  reason,
}) {
  const moduleLabel = moduleName ? ` for ${moduleName}` : '';
  const text = `
Dear ${studentFirstName},

Thank you for your interest in a tutor position${moduleLabel} at the University of Mpumalanga.

After review, your application was not successful on this occasion.

Reason: ${reason}

If you have questions, contact the Student Employment Office.

Kind regards,
Student Employment Office
University of Mpumalanga
  `.trim();

  const body = `
    <p style="margin:0 0 16px;">Dear ${escapeHtml(studentFirstName)},</p>
    <p style="margin:0 0 16px;">
      Thank you for your interest in a tutor position${moduleLabel ? ` for <strong>${escapeHtml(moduleName)}</strong>` : ''}
      at the University of Mpumalanga.
    </p>
    <p style="margin:0 0 16px;">After review, your application was not successful on this occasion.</p>
    <p style="margin:0 0 16px;padding:14px 16px;background:#f9fafb;border-left:3px solid #e5e7eb;color:#4b5563;font-size:14px;">
      <strong>Reason:</strong> ${escapeHtml(reason)}
    </p>
    <p style="margin:0;">If you have questions, contact the Student Employment Office.</p>`;

  await sendResendEmail({
    to: studentEmail,
    subject: 'Update on Your Tutor Application — UMP',
    html: wrapEmailHtml(body),
    text,
  });
}

function buildClaimEmailHtml(messageText) {
  const loginLink = referralLoginLink();
  const paragraphs = String(messageText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p style="margin:0 0 16px;">${escapeHtml(line)}</p>`)
    .join('');

  const body = `
    ${paragraphs || '<p style="margin:0 0 16px;">You have a claim update in VeriFlow.</p>'}
    <p style="margin:0 0 24px;text-align:center;">
      <a href="${escapeHtml(loginLink)}" style="display:inline-block;padding:14px 28px;background:${DARK};color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:1px;border-radius:6px;">LOG IN TO VERIFLOW →</a>
    </p>`;

  return wrapEmailHtml(body);
}

async function sendClaimEmail({ to, subject, text }) {
  if (!to) {
    console.warn('Claim email skipped — no recipient');
    return false;
  }
  if (!process.env.RESEND_API_KEY) {
    console.warn(`Claim email skipped (no RESEND_API_KEY): ${subject} → ${to}`);
    return false;
  }

  const html = buildClaimEmailHtml(text);

  try {
    await sendResendEmail({ to, subject, text, html });
    console.log(`Claim email sent: ${subject} → ${to}`);
    return true;
  } catch (err) {
    console.error(`Claim email failed (${to}):`, err.message);
    return false;
  }
}

module.exports = {
  sendAnnouncementEmail,
  sendApplicationApprovedEmail,
  sendApplicationRejectedEmail,
  sendClaimEmail,
  buildClaimEmailHtml,
  formatClosingDate,
  createResendClient,
  sendReferralNotificationEmail,
  sendReferralApprovalEmail,
  sendReferralApprovalNoPasswordEmail,
  sendLecturerWelcomeEmail,
  sendPasswordResetEmail,
  referralLoginLink,
  buildAnnouncementHtml,
  buildReferralNotificationHtml,
  buildReferralApprovalHtml,
  buildLecturerWelcomeHtml,
  buildPasswordResetHtml,
};
