'use strict';

const pool = require('../db');

async function fetchTokenVersion(userId) {
  try {
    const result = await pool.query(
      'SELECT COALESCE(token_version, 0) AS token_version FROM users WHERE id = $1',
      [userId]
    );
    return Number(result.rows[0]?.token_version) || 0;
  } catch (err) {
    if (err.code === '42703') return 0;
    throw err;
  }
}

async function bumpTokenVersion(userId) {
  try {
    const result = await pool.query(
      `UPDATE users
       SET token_version = COALESCE(token_version, 0) + 1
       WHERE id = $1
       RETURNING token_version`,
      [userId]
    );
    return Number(result.rows[0]?.token_version) || 0;
  } catch (err) {
    if (err.code === '42703') return 0;
    throw err;
  }
}

module.exports = { fetchTokenVersion, bumpTokenVersion };
