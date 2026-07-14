'use strict';

const crypto = require('crypto');

/** Cryptographically secure temporary password (default 12 chars). */
function generateTempPassword(length = 12) {
  const chars =
    'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#$!';
  const bytes = crypto.randomBytes(length);
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars[bytes[i] % chars.length];
  }
  return password;
}

module.exports = { generateTempPassword };
