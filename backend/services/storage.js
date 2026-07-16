'use strict';

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const BUCKET = 'veriflow-uploads';

/**
 * Upload a file to Supabase Storage.
 * @param {string} localPath - full path to the local file
 * @param {string} storagePath - path within the bucket
 *   e.g. 'applications/userId_cv_timestamp.pdf'
 * @param {string} mimeType - e.g. 'application/pdf'
 * @returns {Promise<string>} the storage path on success
 */
async function uploadFile(localPath, storagePath, mimeType) {
  const fs = require('fs');
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

module.exports = { uploadFile, getSignedUrl, deleteFile, BUCKET };
