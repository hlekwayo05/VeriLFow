'use strict';

const router = require('express').Router();
const pool   = require('../db');

function formatClosingDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

async function readPublicSettingsFromDb() {
  try {
    const result = await pool.query(
      'SELECT applications_open, closing_date FROM settings WHERE id = 1'
    );
    if (result.rows.length > 0) {
      const row = result.rows[0];
      return {
        applications_open: !!row.applications_open,
        closing_date: formatClosingDate(row.closing_date),
      };
    }
  } catch (err) {
    if (err.code !== '42P01') throw err;
  }

  try {
    const result = await pool.query(
      `SELECT key, value FROM system_settings
       WHERE key IN ('applications_open', 'closing_date')`
    );
    const map = {};
    for (const row of result.rows) map[row.key] = row.value;
    const openVal = map.applications_open;
    return {
      applications_open: openVal === true || openVal === 'true' || openVal === '1',
      closing_date: map.closing_date ? formatClosingDate(map.closing_date) : null,
    };
  } catch (err) {
    if (err.code !== '42P01') throw err;
  }

  return { applications_open: false, closing_date: null };
}

async function isApplicationsOpenFromDb() {
  const settings = await readPublicSettingsFromDb();
  return !!settings.applications_open;
}

// GET /api/public/settings — no authentication required
router.get('/settings', async (req, res) => {
  try {
    const settings = await readPublicSettingsFromDb();
    return res.status(200).json(settings);
  } catch (err) {
    console.error('Public settings error:', err.message);
    return res.status(500).json({ errors: ['Server error.'] });
  }
});

// GET /api/public/settings-extended — pay rates and semester cap (no auth)
router.get('/settings-extended', async (req, res) => {
  try {
    const { getAppSettings } = require('../services/settings');
    const row = await getAppSettings();
    return res.status(200).json({
      max_hours_per_semester: row.max_hours_per_semester != null
        ? parseInt(row.max_hours_per_semester, 10)
        : 160,
      rate_undergrad: row.rate_undergrad != null ? parseFloat(row.rate_undergrad) : 70,
      rate_honours:   row.rate_honours != null ? parseFloat(row.rate_honours) : 85,
      rate_masters:   row.rate_masters != null ? parseFloat(row.rate_masters) : 100,
    });
  } catch (err) {
    console.error('Public settings-extended error:', err.message);
    return res.status(500).json({ errors: ['Server error.'] });
  }
});

module.exports = router;
module.exports.readPublicSettingsFromDb = readPublicSettingsFromDb;
module.exports.isApplicationsOpenFromDb = isApplicationsOpenFromDb;
