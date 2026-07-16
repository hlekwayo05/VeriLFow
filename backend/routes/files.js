'use strict';

const crypto = require('crypto');
const fs   = require('fs');
const path = require('path');
const jwt  = require('jsonwebtoken');
const router = require('express').Router();
const pool = require('../db');
const authenticate = require('../middleware/authenticate');
const { getSignedUrl } = require('../services/storage');

const UPLOADS_DIR = path.join(__dirname, '../uploads');

/** One-time tokens for local-disk fallback only (iframes cannot send Bearer). */
const downloadTokens = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of downloadTokens) {
    if (entry.expiresAt < now) downloadTokens.delete(key);
  }
}, 60 * 1000);

function buildStoragePath(filename) {
  if (filename.includes('_cvFile_') || filename.includes('_transcriptFile_')) {
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

function safeBasename(raw) {
  const decoded = decodeURIComponent(String(raw || ''));
  if (!decoded || decoded.includes('..')) return null;
  const base = path.basename(decoded.replace(/\\/g, '/'));
  if (!base || base === '.' || base === '..') return null;
  return base;
}

function resolveStoragePath(raw) {
  const decoded = decodeURIComponent(String(raw || '')).replace(/\\/g, '/');
  if (!decoded || decoded.includes('..')) return null;

  if (
    decoded.startsWith('applications/') ||
    decoded.startsWith('onboarding/') ||
    decoded.startsWith('uploads/')
  ) {
    return decoded;
  }

  const base = safeBasename(decoded);
  if (!base) return null;
  return buildStoragePath(base);
}

function fileMatchSql(column, paramIndex) {
  return `(
    ${column} = $${paramIndex}
    OR ${column} = $${paramIndex + 1}
    OR ${column} LIKE '%/' || $${paramIndex}
  )`;
}

async function userOwnsFilename(userId, basename, storagePath) {
  const result = await pool.query(
    `SELECT 1
     FROM users u
     LEFT JOIN applications a ON a.user_id = u.id
     WHERE u.id = $3
       AND (
         ${fileMatchSql('u.id_document_filename', 1)}
         OR ${fileMatchSql('u.tax_proof_filename', 1)}
         OR ${fileMatchSql('u.bank_proof_filename', 1)}
         OR ${fileMatchSql('a.cv_filename', 1)}
         OR ${fileMatchSql('a.transcript_filename', 1)}
       )
     LIMIT 1`,
    [basename, storagePath, userId]
  );
  return result.rows.length > 0;
}

async function lecturerCanAccessFilename(lecturerId, basename, storagePath) {
  const result = await pool.query(
    `SELECT 1
     FROM applications a
     WHERE (
         ${fileMatchSql('a.cv_filename', 1)}
         OR ${fileMatchSql('a.transcript_filename', 1)}
       )
       AND (
         a.assigned_lecturer_id = $3
         OR a.module_code IN (
           SELECT module_code FROM lecturer_modules WHERE lecturer_id = $3
         )
       )
     LIMIT 1`,
    [basename, storagePath, lecturerId]
  );
  if (result.rows.length > 0) return true;

  const onboarding = await pool.query(
    `SELECT 1
     FROM users u
     JOIN applications a ON a.user_id = u.id AND a.status = 'approved'
     WHERE (
         ${fileMatchSql('u.id_document_filename', 1)}
         OR ${fileMatchSql('u.tax_proof_filename', 1)}
         OR ${fileMatchSql('u.bank_proof_filename', 1)}
       )
       AND (
         a.assigned_lecturer_id = $3
         OR a.module_code IN (
           SELECT module_code FROM lecturer_modules WHERE lecturer_id = $3
         )
       )
     LIMIT 1`,
    [basename, storagePath, lecturerId]
  );
  return onboarding.rows.length > 0;
}

async function canAccessFile(user, basename, storagePath) {
  if (user.role === 'admin') return true;
  if (await userOwnsFilename(user.userId, basename, storagePath)) return true;
  if (user.role === 'lecturer') {
    return lecturerCanAccessFilename(user.userId, basename, storagePath);
  }
  return false;
}

function authenticateFileDownload(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      req.user = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
      return next();
    } catch {
      return res.status(401).json({ errors: ['Invalid or expired token'] });
    }
  }

  const dt = req.query.dt;
  if (dt) {
    const entry = downloadTokens.get(String(dt));
    if (!entry || entry.expiresAt < Date.now()) {
      return res.status(401).json({ errors: ['Download link expired or invalid.'] });
    }
    const base = safeBasename(req.params.filename);
    if (!base || entry.filename !== base) {
      return res.status(401).json({ errors: ['Download link expired or invalid.'] });
    }
    req.user = entry.user;
    downloadTokens.delete(String(dt));
    return next();
  }

  return res.status(401).json({ errors: ['No token provided'] });
}

// GET /api/files/:filename/token — Supabase signed URL (Bearer auth)
router.get('/:filename/token', authenticate, async (req, res) => {
  try {
    const basename = safeBasename(req.params.filename);
    const storagePath = resolveStoragePath(req.params.filename);
    if (!basename || !storagePath) {
      return res.status(400).json({ errors: ['Invalid filename'] });
    }

    const allowed = await canAccessFile(req.user, basename, storagePath);
    if (!allowed) {
      return res.status(403).json({
        errors: ['You do not have permission to access this file.'],
      });
    }

    try {
      const url = await getSignedUrl(storagePath, 60);
      return res.status(200).json({ url, expiresIn: 60 });
    } catch (storageErr) {
      const localPath = path.join(UPLOADS_DIR, basename);
      if (!fs.existsSync(localPath)) {
        console.error('Signed URL failed:', storageErr.message);
        return res.status(404).json({ errors: ['File not found.'] });
      }

      // Local fallback: one-time ?dt= token (no JWT in URL)
      const downloadToken = crypto.randomBytes(32).toString('hex');
      downloadTokens.set(downloadToken, {
        user: req.user,
        filename: basename,
        expiresAt: Date.now() + 60 * 1000,
      });

      return res.status(200).json({
        url: `/api/files/${encodeURIComponent(basename)}?dt=${encodeURIComponent(downloadToken)}`,
        expiresIn: 60,
        local: true,
      });
    }
  } catch (err) {
    console.error('File download token error:', err.message);
    return res.status(500).json({ errors: ['Server error.'] });
  }
});

// GET /api/files/:filename — Supabase signed redirect, else local disk
router.get('/:filename', authenticateFileDownload, async (req, res) => {
  try {
    const basename = safeBasename(req.params.filename);
    const storagePath = resolveStoragePath(req.params.filename);
    if (!basename || !storagePath) {
      return res.status(400).json({ errors: ['Invalid filename'] });
    }

    const allowed = await canAccessFile(req.user, basename, storagePath);
    if (!allowed) {
      return res.status(403).json({
        errors: ['You do not have permission to access this file.'],
      });
    }

    try {
      const signedUrl = await getSignedUrl(storagePath, 60);
      return res.redirect(signedUrl);
    } catch (storageErr) {
      const localPath = path.join(UPLOADS_DIR, basename);
      if (fs.existsSync(localPath)) {
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.removeHeader('X-Frame-Options');
        return res.sendFile(localPath);
      }
      return res.status(404).json({ errors: ['File not found.'] });
    }
  } catch (err) {
    console.error('File serve error:', err.message);
    return res.status(500).json({ errors: ['Server error.'] });
  }
});

module.exports = router;
