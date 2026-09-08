'use strict';

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const BUCKET = 'veriflow-uploads';
const UPLOADS_DIR = path.join(__dirname, '../uploads');

/**
 * Upload a file to Supabase Storage.
 * @param {string} localPath - full path to the local file
 * @param {string} storagePath - path within the bucket
 *   e.g. 'applications/userId_cv_timestamp.pdf'
 * @param {string} mimeType - e.g. 'application/pdf'
 * @returns {Promise<string>} the storage path on success
 */
async function uploadFile(localPath, storagePath, mimeType) {
  const fileBuffer = fs.readFileSync(localPath);

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType: mimeType || 'application/octet-stream',
      upsert: true,
    });

  if (error) throw new Error('Storage upload failed: ' + error.message);
  return storagePath;
}

/**
 * Get a signed URL for temporary file access (60 seconds).
 * Used for admin document preview and tutor profile.
 * @param {string} storagePath - path within the bucket
 * @returns {Promise<string>} signed URL valid for 60 seconds
 */
async function getSignedUrl(storagePath, expiresIn = 60) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresIn);

  if (error) throw new Error('Signed URL failed: ' + error.message);
  return data.signedUrl;
}

/**
 * Delete a file from Supabase Storage.
 * @param {string} storagePath - path within the bucket
 */
async function deleteFile(storagePath) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .remove([storagePath]);

  if (error) console.error('Storage delete failed:', error.message);
}

function buildStoragePath(filename) {
  if (
    filename.includes('_cvFile_') ||
    filename.includes('_transcriptFile_') ||
    filename.includes('_idCopyFile_') ||
    filename.includes('_taxProofFile_') ||
    filename.includes('_bankProofFile_') ||
    filename.includes('_idFile_') ||
    filename.includes('_taxFile_') ||
    filename.includes('_bankFile_')
  ) {
    return 'applications/' + filename;
  }
  if (
    filename.includes('_id_document_') ||
    filename.includes('_tax_proof_') ||
    filename.includes('_bank_proof_')
  ) {
    return 'onboarding/' + filename;
  }
  return 'uploads/' + filename;
}

/**
 * Normalize a DB filename / storage path for bucket lookup.
 * @param {string} raw
 * @returns {string|null}
 */
function normalizeStoragePath(raw) {
  const decoded = decodeURIComponent(String(raw || '')).replace(/\\/g, '/');
  if (!decoded || decoded.includes('..')) return null;

  if (
    decoded.startsWith('applications/') ||
    decoded.startsWith('onboarding/') ||
    decoded.startsWith('uploads/')
  ) {
    return decoded;
  }

  const base = path.basename(decoded);
  if (!base || base === '.' || base === '..') return null;
  return buildStoragePath(base);
}

/**
 * Read a stored upload as a Buffer (Supabase first, local uploads/ fallback).
 * @param {string} rawPath
 * @returns {Promise<Buffer|null>}
 */
async function readStoredFile(rawPath) {
  const storagePath = normalizeStoragePath(rawPath);
  if (!storagePath) return null;

  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .download(storagePath);
    if (!error && data) {
      const ab = await data.arrayBuffer();
      return Buffer.from(ab);
    }
  } catch (err) {
    console.warn('Storage download failed:', storagePath, err.message);
  }

  const basename = path.basename(storagePath);
  const localCandidates = [
    path.join(UPLOADS_DIR, basename),
    path.join(UPLOADS_DIR, storagePath),
  ];
  for (const localPath of localCandidates) {
    if (fs.existsSync(localPath)) {
      return fs.readFileSync(localPath);
    }
  }
  return null;
}

module.exports = {
  uploadFile,
  getSignedUrl,
  deleteFile,
  readStoredFile,
  normalizeStoragePath,
  BUCKET,
};
