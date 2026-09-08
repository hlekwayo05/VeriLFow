'use strict';

/**
 * Extract numeric student number from a UMP student email.
 * e.g. 230383025@ump.ac.za → "230383025"
 * @param {string} email
 * @returns {string|null}
 */
function studentNumberFromUmpEmail(email) {
  const m = String(email || '').trim().match(/^(\d+)@ump\.ac\.za$/i);
  return m ? m[1] : null;
}

module.exports = { studentNumberFromUmpEmail };
