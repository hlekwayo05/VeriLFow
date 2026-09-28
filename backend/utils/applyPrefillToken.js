'use strict';

const crypto = require('crypto');

function secret() {
  const key = process.env.JWT_SECRET;
  if (!key) throw new Error('JWT_SECRET missing');
  return key;
}

function signApplyPrefillToken(studentId, expiresAtMs) {
  const payload = Buffer.from(JSON.stringify({
    sid: Number(studentId),
    exp: Number(expiresAtMs),
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyApplyPrefillToken(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!payload || !sig) return null;

  const expected = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!data || !Number.isInteger(data.sid) || data.sid <= 0) return null;
  if (!Number.isFinite(data.exp) || Date.now() > data.exp) return null;
  return data.sid;
}

/** First letter of the first name and first letter of the surname. */
function initialsFromNames(firstNames, surname) {
  const first = String(firstNames || '').trim().charAt(0).toUpperCase();
  const last = String(surname || '').trim().charAt(0).toUpperCase();
  return (first + last).slice(0, 6);
}

function applyPrefillExpiryMs(closingDate) {
  if (closingDate) {
    const day = closingDate instanceof Date
      ? closingDate.toISOString().slice(0, 10)
      : String(closingDate).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      const end = Date.parse(`${day}T23:59:59.999Z`);
      if (Number.isFinite(end) && end > Date.now()) return end;
    }
  }
  return Date.now() + 60 * 24 * 60 * 60 * 1000;
}

function withApplyPrefillToken(portalLink, token) {
  if (!token) return portalLink;
  const sep = String(portalLink).includes('?') ? '&' : '?';
  return `${portalLink}${sep}t=${encodeURIComponent(token)}`;
}

module.exports = {
  signApplyPrefillToken,
  verifyApplyPrefillToken,
  initialsFromNames,
  applyPrefillExpiryMs,
  withApplyPrefillToken,
};
