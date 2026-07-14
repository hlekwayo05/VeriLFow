'use strict';

const pool = require('../db');

const LEGACY_DEFAULTS = {
  cv_keywords:      'programming, database, SQL, networking, data structures, algorithms, web development, software engineering, system analysis, object oriented, Python, Java, HTML, CSS, JavaScript, Linux, operating systems, cybersecurity, data analytics, mobile development, tutoring, mentoring, teaching, communication, leadership, teamwork, problem solving, time management',
  min_average:      '75',
  module_pass_mark: '70',
  min_cv_keywords:  '0',
};

const ROW_DEFAULTS = {
  id:                   1,
  min_average:          75,
  module_pass_mark:     70,
  cv_keywords:          LEGACY_DEFAULTS.cv_keywords,
  min_cv_keywords:      0,
  applications_open:    false,
  closing_date:         null,
  announcement_subject: 'Tutor Applications Now Open — 2026 Academic Year',
  announcement_body:    `Dear Students,

Applications are now open for tutor positions for the 2026 academic year. To apply click the link below.

Closing date: {closing_date}

Kind regards,
Student Employment Office
University of Mpumalanga`,
  rate_undergrad:         70,
  rate_honours:           85,
  rate_masters:           100,
  max_hours_per_semester: 160,
};

let cache     = null;
let cacheTime = 0;
const CACHE_TTL_MS = 30_000;

async function readLegacySettings() {
  const settings = { ...LEGACY_DEFAULTS };
  try {
    const result = await pool.query('SELECT key, value FROM system_settings');
    for (const row of result.rows) {
      settings[row.key] = row.value;
    }
  } catch (err) {
    if (err.code !== '42P01') throw err;
  }
  return settings;
}

async function getAppSettings() {
  const now = Date.now();
  if (cache && now - cacheTime < CACHE_TTL_MS) return { ...cache };

  try {
    const result = await pool.query('SELECT * FROM settings WHERE id = 1');
    if (result.rows.length > 0) {
      cache     = result.rows[0];
      cacheTime = now;
      return { ...cache };
    }
  } catch (err) {
    if (err.code !== '42P01') throw err;
  }

  const legacy = await readLegacySettings();
  cache = {
    ...ROW_DEFAULTS,
    cv_keywords:      legacy.cv_keywords,
    min_average:      parseFloat(legacy.min_average),
    module_pass_mark: parseFloat(legacy.module_pass_mark),
    min_cv_keywords:  parseInt(legacy.min_cv_keywords, 10),
  };
  cacheTime = now;
  return { ...cache };
}

async function getSettings() {
  const row = await getAppSettings();
  return {
    cv_keywords:      String(row.cv_keywords ?? LEGACY_DEFAULTS.cv_keywords),
    min_average:      String(row.min_average ?? LEGACY_DEFAULTS.min_average),
    module_pass_mark: String(row.module_pass_mark ?? LEGACY_DEFAULTS.module_pass_mark),
    min_cv_keywords:  String(row.min_cv_keywords ?? LEGACY_DEFAULTS.min_cv_keywords),
  };
}

async function updateSettings(updates) {
  const allowed = [
    'min_average',
    'module_pass_mark',
    'cv_keywords',
    'min_cv_keywords',
    'applications_open',
    'closing_date',
    'announcement_subject',
    'announcement_body',
    'rate_undergrad',
    'rate_honours',
    'rate_masters',
    'max_hours_per_semester',
  ];

  const entries = Object.entries(updates).filter(([k]) => allowed.includes(k));
  if (!entries.length) return getAppSettings();

  const setClauses = [];
  const values     = [];
  let idx = 1;

  for (const [key, value] of entries) {
    setClauses.push(`${key} = $${idx}`);
    if (key === 'applications_open') {
      values.push(value === true || value === 'true');
    } else if (key === 'closing_date') {
      values.push(value || null);
    } else if (key === 'min_cv_keywords') {
      values.push(parseInt(value, 10));
    } else if (key === 'min_average' || key === 'module_pass_mark') {
      values.push(parseFloat(value));
    } else if (key === 'rate_undergrad' || key === 'rate_honours' || key === 'rate_masters') {
      values.push(parseFloat(value));
    } else if (key === 'max_hours_per_semester') {
      values.push(parseInt(value, 10));
    } else {
      values.push(String(value).trim());
    }
    idx += 1;
  }

  setClauses.push('updated_at = NOW()');

  try {
    const result = await pool.query(
      `UPDATE settings SET ${setClauses.join(', ')} WHERE id = 1 RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      await pool.query('INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
      return updateSettings(updates);
    }

    cache     = null;
    cacheTime = 0;
    return result.rows[0];
  } catch (err) {
    if (err.code === '42P01') {
      for (const [key, value] of entries) {
        if (LEGACY_DEFAULTS[key] !== undefined) {
          await pool.query(
            `INSERT INTO system_settings (key, value, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
            [key, String(value).trim()]
          );
        }
      }
      cache     = null;
      cacheTime = 0;
      return getAppSettings();
    }
    throw err;
  }
}

function invalidateSettingsCache() {
  cache     = null;
  cacheTime = 0;
}

module.exports = {
  LEGACY_DEFAULTS,
  ROW_DEFAULTS,
  getAppSettings,
  getSettings,
  updateSettings,
  invalidateSettingsCache,
};
