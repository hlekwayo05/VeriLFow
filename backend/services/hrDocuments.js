'use strict';

/**
 * Resolve HR supporting-document paths from an applications + users join row.
 */
function resolveHrDocumentPaths(row = {}) {
  return {
    cv: row.cv_filename || null,
    transcript: row.transcript_filename || null,
    id:
      row.id_filename ||
      row.id_copy_filename ||
      row.id_document_filename ||
      null,
    tax:
      row.tax_filename ||
      row.tax_proof_filename ||
      row.user_tax_proof_filename ||
      null,
    bank:
      row.bank_filename ||
      row.bank_proof_filename ||
      row.user_bank_proof_filename ||
      null,
  };
}

const HR_DOC_LABELS = {
  cv: 'CV',
  transcript: 'Academic record',
  id: 'ID copy',
  tax: 'Tax proof',
  bank: 'Banking proof',
};

function missingHrDocumentLabels(rowOrPaths) {
  const paths =
    rowOrPaths && (rowOrPaths.cv !== undefined || rowOrPaths.cv_filename !== undefined)
      ? rowOrPaths.cv_filename !== undefined
        ? resolveHrDocumentPaths(rowOrPaths)
        : rowOrPaths
      : resolveHrDocumentPaths(rowOrPaths);
  return Object.entries(HR_DOC_LABELS)
    .filter(([key]) => !paths[key])
    .map(([, label]) => label);
}

function hasRequiredHrDocuments(rowOrPaths) {
  return missingHrDocumentLabels(rowOrPaths).length === 0;
}

const HR_DOC_STATUS_SQL = `
  a.cv_filename,
  a.transcript_filename,
  a.id_filename,
  a.id_copy_filename,
  a.tax_filename,
  a.tax_proof_filename,
  a.bank_filename,
  a.bank_proof_filename,
  a.cv_original_name,
  a.transcript_original_name,
  a.id_copy_original_name,
  a.tax_proof_original_name,
  a.bank_proof_original_name,
  u.id_document_filename,
  u.tax_proof_filename AS user_tax_proof_filename,
  u.bank_proof_filename AS user_bank_proof_filename
`;

async function loadHrDocumentStatus(pool, userId) {
  const result = await pool.query(
    `SELECT ${HR_DOC_STATUS_SQL}
     FROM applications a
     JOIN users u ON u.id = a.user_id
     WHERE a.user_id = $1 AND a.status = 'approved'
     ORDER BY a.updated_at DESC NULLS LAST, a.id DESC
     LIMIT 1`,
    [userId]
  );
  if (!result.rows.length) return null;
  const row = result.rows[0];
  const paths = resolveHrDocumentPaths(row);
  return {
    ...paths,
    missing: missingHrDocumentLabels(paths),
    complete: hasRequiredHrDocuments(paths),
    originals: {
      cv: row.cv_original_name || null,
      transcript: row.transcript_original_name || null,
      id: row.id_copy_original_name || null,
      tax: row.tax_proof_original_name || null,
      bank: row.bank_proof_original_name || null,
    },
  };
}

module.exports = {
  resolveHrDocumentPaths,
  missingHrDocumentLabels,
  hasRequiredHrDocuments,
  loadHrDocumentStatus,
  HR_DOC_LABELS,
  HR_DOC_STATUS_SQL,
};
