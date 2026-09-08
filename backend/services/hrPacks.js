'use strict';

const path = require('path');
const { ZipArchive } = require('archiver');
const { getAppSettings } = require('./settings');
const {
  generateAppointmentFormD,
  generateConfirmationForm,
  launchPdfBrowser,
} = require('./formGenerator');
const {
  formPdfFilenames,
  sanitizeFilenamePart,
} = require('./appointmentForms');
const { readStoredFile } = require('./storage');

const PACK_QUERY = `
  SELECT
    a.id AS application_id,
    a.status,
    a.offer_accepted_at,
    a.qualification_level,
    a.responsibility_level,
    a.module_name,
    a.module_code,
    a.position_type,
    a.cost_centre,
    a.cv_filename,
    a.cv_original_name,
    a.transcript_filename,
    a.transcript_original_name,
    a.id_filename,
    a.id_copy_filename,
    a.id_copy_original_name,
    a.tax_filename,
    a.tax_proof_filename,
    a.tax_proof_original_name,
    a.bank_filename,
    a.bank_proof_filename,
    a.bank_proof_original_name,
    u.id AS user_id,
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
  FROM applications a
  JOIN users u ON u.id = a.user_id
  LEFT JOIN tutor_profiles tp ON tp.user_id = a.user_id
  WHERE a.status = 'approved'
    AND a.offer_accepted_at IS NOT NULL
    AND (u.staff_number IS NULL OR TRIM(u.staff_number) = '')
    AND u.role = 'tutor'
`;

function packFolderName(row) {
  const student = sanitizeFilenamePart(row.student_number) || `user_${row.user_id}`;
  const surname = sanitizeFilenamePart(row.surname) || 'tutor';
  return `${student}_${surname}`;
}

function extensionFromName(name, fallback = '.pdf') {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (ext && /^\.[a-z0-9]{1,8}$/i.test(ext)) return ext;
  return fallback;
}

/** Stable HR pack filenames — ignore unreliable upload original names. */
async function appendStoredDoc(archive, folder, label, storagePath) {
  if (!storagePath) return false;
  const buf = await readStoredFile(storagePath);
  if (!buf) return false;
  const ext = extensionFromName(storagePath);
  archive.append(buf, { name: `${folder}/${label}${ext}` });
  return true;
}

function csvEscape(value) {
  return `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
}

function buildManifestCsv(rows) {
  const headers = [
    'student_number',
    'first_names',
    'surname',
    'email',
    'position_type',
    'id_number',
    'tax_number',
    'qualification_level',
    'module_name',
    'cost_centre',
    'offer_accepted_at',
    'staff_number',
  ];
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.student_number,
        r.first_names,
        r.surname,
        r.email,
        r.position_type || 'tutor',
        r.id_number,
        r.taxnum,
        r.qualification_level,
        r.module_name,
        r.cost_centre,
        r.offer_accepted_at
          ? new Date(r.offer_accepted_at).toISOString()
          : '',
        '',
      ]
        .map(csvEscape)
        .join(',')
    );
  }
  return lines.join('\n');
}

/**
 * Stream an HR pack ZIP for accepted appointees still missing a staff number.
 * @param {import('pg').Pool} pool
 * @param {import('express').Response} res
 * @param {{ applicationIds?: number[], positionType?: 'tutor'|'demonstrator' }} [options]
 * @returns {Promise<{ count: number }>}
 */
async function streamHrPacksZip(pool, res, options = {}) {
  let query = PACK_QUERY;
  const params = [];
  const positionType =
    options.positionType === 'demonstrator' || options.positionType === 'tutor'
      ? options.positionType
      : null;

  if (positionType === 'demonstrator') {
    query += ` AND COALESCE(a.position_type, 'tutor') = 'demonstrator'`;
  } else if (positionType === 'tutor') {
    query += ` AND COALESCE(a.position_type, 'tutor') = 'tutor'`;
  }

  if (options.applicationIds?.length) {
    params.push(options.applicationIds);
    query += ` AND a.id = ANY($${params.length}::int[])`;
  }

  query += ' ORDER BY u.surname ASC, u.first_names ASC';

  const result = await pool.query(query, params);
  const rows = result.rows;
  const roleLabel =
    positionType === 'demonstrator' ? 'demonstrators' : 'tutors';
  const roleLabelSingular =
    positionType === 'demonstrator' ? 'demonstrator' : 'tutor';

  if (!rows.length) {
    const err = new Error(
      `No accepted ${roleLabel} without a staff number are ready for an HR pack.`
    );
    err.status = 404;
    throw err;
  }

  const settings = await getAppSettings();
  const dateStamp = new Date().toISOString().slice(0, 10);
  const packKind =
    positionType === 'demonstrator'
      ? 'Demonstrators'
      : positionType === 'tutor'
        ? 'Tutors'
        : 'All';
  const filename = `VeriFlow_HR_Packs_${packKind}_${dateStamp}.zip`;
  const csvName = `VeriFlow_HR_StaffNumbers_${packKind}_${dateStamp}.csv`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename}"`
  );

  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.on('error', (err) => {
    console.error('HR pack archive error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ errors: ['Could not build HR pack.'] });
    } else {
      res.end();
    }
  });
  archive.pipe(res);

  archive.append(buildManifestCsv(rows), { name: csvName });

  const missingNotes = [];
  const browser = await launchPdfBrowser();

  try {
    for (const row of rows) {
      const folder = packFolderName(row);
      const application = {
        ...row,
        id: row.application_id,
      };
      const names = formPdfFilenames(application);

      try {
        const formD = await generateAppointmentFormD({
          application,
          settings,
          browser,
        });
        archive.append(Buffer.from(formD), {
          name: `${folder}/${names.formD}`,
        });
      } catch (err) {
        missingNotes.push(`${folder}: Form D failed (${err.message})`);
      }

      try {
        const confirmation = await generateConfirmationForm({
          application,
          settings,
          browser,
        });
        archive.append(Buffer.from(confirmation), {
          name: `${folder}/${names.confirmation}`,
        });
      } catch (err) {
        missingNotes.push(
          `${folder}: Confirmation failed (${err.message})`
        );
      }

      const docs = [
        { label: 'CV', path: row.cv_filename },
        { label: 'Academic_Record', path: row.transcript_filename },
        {
          label: 'ID_Copy',
          path:
            row.id_filename ||
            row.id_copy_filename ||
            row.id_document_filename,
        },
        {
          label: 'Tax_Proof',
          path:
            row.tax_filename ||
            row.tax_proof_filename ||
            row.user_tax_proof_filename,
        },
        {
          label: 'Banking_Proof',
          path:
            row.bank_filename ||
            row.bank_proof_filename ||
            row.user_bank_proof_filename,
        },
      ];

      for (const doc of docs) {
        const ok = await appendStoredDoc(
          archive,
          folder,
          doc.label,
          doc.path
        );
        if (!ok && doc.path) {
          missingNotes.push(`${folder}: missing ${doc.label}`);
        } else if (!doc.path) {
          missingNotes.push(`${folder}: no ${doc.label} on file`);
        }
      }
    }
  } finally {
    await browser.close();
  }

  if (missingNotes.length) {
    archive.append(missingNotes.join('\n') + '\n', {
      name: 'MISSING_DOCUMENTS.txt',
    });
  }

  await archive.finalize();
  return { count: rows.length, roleLabelSingular };
}

module.exports = {
  streamHrPacksZip,
};
