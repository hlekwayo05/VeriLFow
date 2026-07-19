'use strict';

const fs = require('fs');

async function validateUploadedFile(file, allowedMimeTypes) {
  if (!file || !file.path) {
    return { valid: false, error: 'Invalid file type.' };
  }

  try {
    const fileBuffer = fs.readFileSync(file.path);
    const { fileTypeFromBuffer } = await import('file-type');
    const detected = await fileTypeFromBuffer(fileBuffer);
    const detectedMime = detected?.mime;

    if (!detectedMime || !allowedMimeTypes.includes(detectedMime)) {
      fs.unlinkSync(file.path);
      return { valid: false, error: 'Invalid file type.' };
    }

    return { valid: true, detectedMime };
  } catch (err) {
    try {
      fs.unlinkSync(file.path);
    } catch (cleanupErr) {
      // Ignore cleanup errors.
    }
    return { valid: false, error: 'Invalid file type.' };
  }
}

module.exports = {
  validateUploadedFile,
};
