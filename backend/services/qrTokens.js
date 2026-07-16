'use strict';

const crypto = require('crypto');
const os     = require('os');
const pool   = require('../db');

const QR_TOKEN_TTL_SECONDS = 10;

function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

function attendancePassExpiry(session) {
  if (session.code_expires_at) {
    return new Date(session.code_expires_at);
  }
  return new Date(Date.now() + 4 * 60 * 60 * 1000);
}

async function getActiveSession(sessionId) {
  const result = await pool.query(
    `SELECT id, status, module_code, topic, session_type, session_date,
            start_time, venue, code_expires_at
     FROM sessions WHERE id = $1`,
    [sessionId]
  );
  return result.rows[0] || null;
}

async function getCurrentQrToken(sessionId) {
  const result = await pool.query(
    `SELECT token, expires_at
     FROM session_qr_tokens
     WHERE session_id = $1 AND expires_at > NOW()
     ORDER BY expires_at DESC
     LIMIT 1`,
    [sessionId]
  );
  return result.rows[0] || null;
}

async function rotateQrToken(sessionId) {
  const current = await getCurrentQrToken(sessionId);
  const secondsLeft = current
    ? Math.floor((new Date(current.expires_at).getTime() - Date.now()) / 1000)
    : 0;

  if (current && secondsLeft > 5) {
    return current;
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + QR_TOKEN_TTL_SECONDS * 1000);

  await pool.query(
    `INSERT INTO session_qr_tokens (session_id, token, expires_at)
     VALUES ($1, $2, $3)`,
    [sessionId, token, expiresAt]
  );

  return { token, expires_at: expiresAt };
}

async function findSessionByQrToken(qrToken) {
  const result = await pool.query(
    `SELECT s.id, s.status, s.module_code, s.topic, s.session_type,
            s.session_date, s.start_time, s.venue, s.code_expires_at,
            t.expires_at AS qr_expires_at
     FROM session_qr_tokens t
     JOIN sessions s ON s.id = t.session_id
     WHERE t.token = $1
       AND t.expires_at > NOW() - INTERVAL '15 seconds'`,
    [qrToken]
  );
  return result.rows[0] || null;
}

async function createAttendancePass(session) {
  const token = generateToken();
  const expiresAt = attendancePassExpiry(session);

  await pool.query(
    `INSERT INTO attendance_passes (token, session_id, expires_at)
     VALUES ($1, $2, $3)`,
    [token, session.id, expiresAt]
  );

  return { token, expires_at: expiresAt };
}

async function findValidPass(passToken) {
  const result = await pool.query(
    `SELECT p.token, p.expires_at, p.session_id,
            s.status, s.module_code, s.topic, s.session_type,
            s.session_date, s.start_time, s.venue
     FROM attendance_passes p
     JOIN sessions s ON s.id = p.session_id
     WHERE p.token = $1 AND p.expires_at > NOW()`,
    [passToken]
  );
  return result.rows[0] || null;
}

function getLanIPv4() {
  const nets = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      const ip = net.address;
      if (ip.startsWith('169.254.')) continue;
      candidates.push({ ip, name: name.toLowerCase() });
    }
  }

  const score = (entry) => {
    const { ip, name } = entry;
    if (ip.startsWith('192.168.56.') || ip.startsWith('172.17.')) return 0;
    if (name.includes('wi-fi') || name.includes('wifi') || name.includes('wlan')) return 100;
    if (ip.startsWith('192.168.')) return 80;
    if (ip.startsWith('10.')) return 70;
    return 10;
  };

  candidates.sort((a, b) => score(b) - score(a));
  return candidates[0]?.ip || null;
}

function resolveFrontendBase() {
  const configured = (process.env.FRONTEND_URL || 'http://localhost:5500/frontend').trim();
  try {
    const url = new URL(configured.includes('://') ? configured : `http://${configured}`);
    const host = url.hostname;
    if (host !== 'localhost' && host !== '127.0.0.1') {
      return configured.replace(/\/$/, '');
    }
    const lan = getLanIPv4();
    if (!lan) return configured.replace(/\/$/, '');
    const port = url.port || '5500';
    const path = url.pathname && url.pathname !== '/' ? url.pathname : '/frontend';
    return `http://${lan}:${port}${path}`.replace(/\/$/, '');
  } catch {
    const lan = getLanIPv4();
    if (lan) return `http://${lan}:5500/frontend`;
    return 'http://localhost:5500/frontend';
  }
}

function resolveApiBase() {
  const lan = getLanIPv4();
  const port = process.env.PORT || 3000;
  if (lan) return `http://${lan}:${port}/api`;
  return `http://localhost:${port}/api`;
}

function buildAttendanceUrl(qrToken) {
  const base = resolveFrontendBase();
  return `${base}/pages/attendance-scan.html?t=${encodeURIComponent(qrToken)}`;
}

function sessionPublicView(row) {
  return {
    sessionId:   row.id || row.session_id,
    moduleCode:  row.module_code,
    topic:       row.topic,
    sessionType: row.session_type,
    sessionDate: row.session_date,
    startTime:   row.start_time,
    venue:       row.venue,
  };
}

module.exports = {
  QR_TOKEN_TTL_SECONDS,
  generateToken,
  getActiveSession,
  getCurrentQrToken,
  rotateQrToken,
  findSessionByQrToken,
  createAttendancePass,
  findValidPass,
  buildAttendanceUrl,
  resolveFrontendBase,
  resolveApiBase,
  getLanIPv4,
  sessionPublicView,
};
