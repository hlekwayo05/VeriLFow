'use strict';

const jwt = require('jsonwebtoken');
const pool = require('../db');

const TEMP_PASSWORD_ALLOWED = new Set([
  '/api/auth/change-password',
  '/api/users/me',
]);

function requestPath(req) {
  const raw = String(req.originalUrl || req.url || '').split('?')[0];
  return raw.replace(/\/+$/, '') || '/';
}

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    if (!payload.userId) {
      req.user = payload;
      return next();
    }

    let row;
    try {
      const result = await pool.query(
        `SELECT COALESCE(token_version, 0) AS token_version,
                role,
                temp_password_flag
         FROM users WHERE id = $1`,
        [payload.userId]
      );
      if (!result.rows.length) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
      row = result.rows[0];
      const currentVersion = Number(row.token_version) || 0;
      const tokenVersion = Number(payload.tv) || 0;
      if (tokenVersion !== currentVersion) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
    } catch (versionErr) {
      if (versionErr.code === '42703') {
        if (process.env.NODE_ENV === 'production') {
          console.error('token_version column missing — refuse auth in production');
          return res.status(503).json({ error: 'Authentication temporarily unavailable' });
        }
        const fallback = await pool.query(
          'SELECT role, temp_password_flag FROM users WHERE id = $1',
          [payload.userId]
        );
        if (!fallback.rows.length) {
          return res.status(401).json({ error: 'Invalid or expired token' });
        }
        row = { ...fallback.rows[0], token_version: 0 };
      } else {
        console.error('auth user check:', versionErr.message);
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
    }

    // Prefer live DB role / temp flag over stale JWT claims
    req.user = {
      ...payload,
      role: row.role,
      tempFlag: !!row.temp_password_flag,
    };

    if (req.user.tempFlag) {
      const path = requestPath(req);
      if (!TEMP_PASSWORD_ALLOWED.has(path)) {
        return res.status(403).json({
          errors: ['You must change your temporary password before continuing.'],
          code: 'TEMP_PASSWORD_REQUIRED',
        });
      }
    }

    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = authenticate;
