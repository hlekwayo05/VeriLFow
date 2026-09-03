'use strict';

const crypto = require('crypto');
const { PASSWORD_MIN, isStrongPassword } = require('./passwordPolicy');

/**
 * Cryptographically secure temporary password that always meets
 * the strong password policy (uppercase, lowercase, digit, special).
 */
function generateTempPassword(length = Math.max(12, PASSWORD_MIN)) {
  const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const special = '@#$!%&*';
  const all = upper + lower + digits + special;

  function pick(set) {
    const bytes = crypto.randomBytes(1);
    return set[bytes[0] % set.length];
  }

  // Guarantee one of each required class, then fill the rest.
  const chars = [
    pick(upper),
    pick(lower),
    pick(digits),
    pick(special),
  ];

  const fillBytes = crypto.randomBytes(Math.max(0, length - chars.length));
  for (let i = 0; i < fillBytes.length; i++) {
    chars.push(all[fillBytes[i] % all.length]);
  }

  // Fisher-Yates shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomBytes(1)[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  const password = chars.join('');
  if (!isStrongPassword(password)) {
    // Extremely unlikely; regenerate once more with a longer length.
    return generateTempPassword(length + 2);
  }
  return password;
}

module.exports = { generateTempPassword };
