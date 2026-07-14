'use strict';

const fs   = require('fs');
const path = require('path');
const jwt  = require('jsonwebtoken');
const router = require('express').Router();
const pool = require('../db');

const UPLOADS_DIR = path.join(__dirname, '../uploads');

/**
 * Auth for file downloads: Bearer header (API) or ?token= (iframe / new-tab links).
 */
function authenticateFile(req, res, next) {
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query.token) {
    token = String(req.query.token);
  }

  if (!token) {
    return res.status(401).json({ errors: ['No token provided'] });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ errors: ['Invalid or expired token'] });
  }
}

async function userOwnsFilename(userId, filename) {
  const result = await pool.query(
    `SELECT 1
     FROM users u
     LEFT JOIN applications a ON a.user_id = u.id
     WHERE u.id = $1
       AND (
         u.id_document_filename = $2
         OR u.tax_proof_filename = $2
         OR u.bank_proof_filename = $2
         OR a.cv_filename = $2
         OR a.transcript_filename = $2
       )
     LIMIT 1`,
    [userId, filename]
  );
  return result.rows.length > 0;
}

async function lecturerCanAccessFilename(lecturerId, filename) {
  const result = await pool.query(
    `SELECT 1
     FROM applications a
     WHERE (a.cv_filename = $1 OR a.transcript_filename = $1)
       AND (
         a.assigned_lecturer_id = $2
         OR a.module_code IN (
           SELECT module_code FROM lecturer_modules WHERE lecturer_id = $2
         )
       )
     LIMIT 1`,
    [filename, lecturerId]
  );
  if (result.rows.length > 0) return true;

  const onboarding = await pool.query(
    `SELECT 1
     FROM users u
     JOIN applications a ON a.user_id = u.id AND a.status = 'approved'
     WHERE (
         u.id_document_filename = $1
         OR u.tax_proof_filename = $1
         OR u.bank_proof_filename = $1
       )
       AND (
         a.assigned_lecturer_id = $2
         OR a.module_code IN (
           SELECT module_code FROM lecturer_modules WHERE lecturer_id = $2
         )
       )
     LIMIT 1`,
    [filename, lecturerId]
  );
  return onboarding.rows.length > 0;
}

async function canAccessFile(user, filename) {
  const role = user.role;
  const userId = user.userId;

  if (role === 'admin') return true;

  if (await userOwnsFilename(userId, filename)) return true;

  if (role === 'lecturer') {
    return lecturerCanAccessFilename(userId, filename);
  }

  return false;
}

// GET /api/files/:filename
router.get('/:filename', authenticateFile, async (req, res) => {
  try {
    const filename = req.params.filename;
    const safe = path.basename(filename);

    if (safe !== filename || filename.includes('..')) {
      return res.status(400).json({ errors: ['Invalid filename'] });
    }

    const filePath = path.join(UPLOADS_DIR, safe);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ errors: ['File not found'] });
    }

    const allowed = await canAccessFile(req.user, safe);
    if (!allowed) {
      return res.status(403).json({ errors: ['You do not have permission to access this file.'] });
    }

    // Allow frontend origin to preview PDFs in an iframe / object URL fetch
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.removeHeader('X-Frame-Options');

    return res.sendFile(filePath);
  } catch (err) {
    console.error('File serve error:', err.message);
    return res.status(500).json({ errors: ['Server error.'] });
  }
});

module.exports = router;
