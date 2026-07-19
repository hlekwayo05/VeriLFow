'use strict';

const router       = require('express').Router();
const pool         = require('../db');
const authenticate = require('../middleware/authenticate');
const requireRole  = require('../middleware/requireRole');
const { adminActionLimiter } = require('../middleware/rateLimiter');
const {
  COURSE_SHORT_MAP,
  courseToProgramme,
  isValidModule,
  minYearLevelToQualEnum,
} = require('../constants');

function normalizePositionType(value) {
  const s = String(value || 'tutor').toLowerCase();
  return s.startsWith('demonstrator') ? 'demonstrator' : 'tutor';
}

function displayPositionType(value) {
  return normalizePositionType(value) === 'demonstrator' ? 'Demonstrator' : 'Tutor';
}


// =============================================================
//  GET /api/postings
//  Admin lists all postings with live application counts.
// =============================================================

router.get(
  '/',
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
           p.id,
           p.module_code,
           p.module_name,
           p.programme,
           p.position_type,
           p.min_year_level,
           p.min_average,
           p.applications_needed,
           p.module_pass_required,
           p.notes,
           p.created_at,
           p.updated_at,
           COUNT(a.id) FILTER (
             WHERE a.status NOT IN ('incomplete', 'rejected')
           )::int AS application_count
         FROM postings p
         LEFT JOIN applications a
           ON a.module_name = p.module_name
           AND (
             (p.programme = 'DICT' AND a.course LIKE 'DICT%')
             OR (p.programme = 'BICT' AND a.course LIKE 'BICT%')
           )
         GROUP BY p.id
         ORDER BY p.module_code ASC`
      );

      return res.status(200).json(result.rows);

    } catch (err) {
      console.error('Get postings error:', err.message);
      return res.status(500).json({ error: 'Server error.' });
    }
  }
);


// =============================================================
//  GET /api/postings/open
//  Authenticated tutors — verify a posting exists for apply flow.
// =============================================================

router.get(
  '/open',
  authenticate,
  requireRole('tutor'),
  async (req, res) => {
    const programme  = req.query.programme || courseToProgramme(req.query.course);
    const moduleName = req.query.moduleName;

    if (!programme || !moduleName) {
      return res.status(400).json({ errors: ['Programme and moduleName are required.'] });
    }

    if (!['DICT', 'BICT'].includes(programme)) {
      return res.status(400).json({ errors: ['Programme must be DICT or BICT.'] });
    }

    try {
      const result = await pool.query(
        `SELECT id, min_year_level, min_average, module_pass_required,
                min_year_level AS min_qualification_level
         FROM postings
         WHERE programme = $1 AND module_name = $2
         LIMIT 1`,
        [programme, moduleName.trim()]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ errors: ['No posting for this module.'] });
      }

      const row = result.rows[0];
      row.min_qualification_level = minYearLevelToQualEnum(row.min_year_level);

      return res.status(200).json(row);

    } catch (err) {
      console.error('Get open posting error:', err.message);
      return res.status(500).json({ error: 'Server error.' });
    }
  }
);


// =============================================================
//  POST /api/postings
// =============================================================

router.post(
  '/',
  adminActionLimiter,
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    const {
      programme,
      moduleCode,
      moduleName,
      moduleYearLevel,
      positionType,
      minYearLevel,
      minAverage,
      appsNeeded,
      applicationsNeeded,
      modulePassRequired,
      notes,
    } = req.body;

    const fullCourse   = COURSE_SHORT_MAP[programme] || programme;
    const appsCount    = applicationsNeeded ?? appsNeeded;
    const yearLevelReq = (minYearLevel || '3rd year+').trim();

    const errors = [];
    if (!programme || !['DICT', 'BICT'].includes(programme)) {
      errors.push('Programme must be DICT or BICT.');
    }
    if (!moduleCode) errors.push('Module code is required.');
    if (!moduleName) errors.push('Module name is required.');
    if (minAverage === undefined || minAverage === null || minAverage === '') {
      errors.push('Minimum average is required.');
    }
    if (!appsCount || parseInt(appsCount, 10) < 1) {
      errors.push('Applications needed must be at least 1.');
    }

    if (errors.length) return res.status(400).json({ errors });

    const avgNum = parseFloat(minAverage);
    if (isNaN(avgNum) || avgNum < 0 || avgNum > 100) {
      return res.status(400).json({ errors: ['Minimum average must be between 0 and 100.'] });
    }

    if (moduleYearLevel && fullCourse && !isValidModule(fullCourse, moduleYearLevel, moduleName)) {
      return res.status(400).json({
        errors: [`"${moduleName}" is not a valid module for ${fullCourse}.`],
      });
    }

    try {
      const existing = await pool.query(
        `SELECT id FROM postings WHERE programme = $1 AND module_name = $2`,
        [programme, moduleName.trim()]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({
          errors: ['A posting already exists for this programme and module.'],
        });
      }

      const result = await pool.query(
        `INSERT INTO postings
           (module_code, module_name, programme, position_type,
            min_year_level, min_average, applications_needed,
            module_pass_required, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          moduleCode.trim().toUpperCase(),
          moduleName.trim(),
          programme,
          normalizePositionType(positionType),
          yearLevelReq,
          avgNum,
          parseInt(appsCount, 10),
          modulePassRequired !== false,
          notes ? notes.trim() : null,
        ]
      );

      return res.status(201).json(result.rows[0]);

    } catch (err) {
      console.error('Create posting error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);


// =============================================================
//  PATCH /api/postings/:id
// =============================================================

router.patch(
  '/:id',
  adminActionLimiter,
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    const postingId = parseInt(req.params.id, 10);
    const {
      programme,
      moduleCode,
      moduleName,
      positionType,
      minYearLevel,
      minAverage,
      appsNeeded,
      applicationsNeeded,
      modulePassRequired,
      notes,
    } = req.body;

    try {
      const current = await pool.query('SELECT * FROM postings WHERE id = $1', [postingId]);
      if (current.rows.length === 0) {
        return res.status(404).json({ errors: ['Posting not found.'] });
      }

      const posting = current.rows[0];
      const nextProgramme = programme || posting.programme;
      const nextModule    = moduleName ? moduleName.trim() : posting.module_name;

      if (
        (programme && programme !== posting.programme)
        || (moduleName && moduleName.trim() !== posting.module_name)
      ) {
        const clash = await pool.query(
          `SELECT id FROM postings
           WHERE programme = $1 AND module_name = $2 AND id != $3`,
          [nextProgramme, nextModule, postingId]
        );
        if (clash.rows.length > 0) {
          return res.status(409).json({
            errors: ['Another posting already exists for this programme and module.'],
          });
        }
      }

      const appsCount = applicationsNeeded ?? appsNeeded;
      const avgNum    = minAverage != null ? parseFloat(minAverage) : posting.min_average;

      const result = await pool.query(
        `UPDATE postings
         SET programme             = COALESCE($1, programme),
             module_code           = COALESCE($2, module_code),
             module_name           = COALESCE($3, module_name),
             position_type         = COALESCE($4, position_type),
             min_year_level        = COALESCE($5, min_year_level),
             min_average           = COALESCE($6, min_average),
             applications_needed   = COALESCE($7, applications_needed),
             module_pass_required  = COALESCE($8, module_pass_required),
             notes                 = COALESCE($9, notes)
         WHERE id = $10
         RETURNING *`,
        [
          programme || null,
          moduleCode ? moduleCode.trim().toUpperCase() : null,
          moduleName ? moduleName.trim() : null,
          positionType ? normalizePositionType(positionType) : null,
          minYearLevel ? minYearLevel.trim() : null,
          minAverage != null ? avgNum : null,
          appsCount != null ? parseInt(appsCount, 10) : null,
          modulePassRequired != null ? modulePassRequired : null,
          notes != null ? (notes.trim() || null) : null,
          postingId,
        ]
      );

      return res.status(200).json(result.rows[0]);

    } catch (err) {
      console.error('Update posting error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);


// =============================================================
//  DELETE /api/postings/:id
// =============================================================

router.delete(
  '/:id',
  adminActionLimiter,
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    const postingId = parseInt(req.params.id, 10);

    try {
      const result = await pool.query(
        'DELETE FROM postings WHERE id = $1 RETURNING id',
        [postingId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ errors: ['Posting not found.'] });
      }

      return res.status(200).json({ message: 'Posting deleted.' });

    } catch (err) {
      console.error('Delete posting error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);


module.exports = router;
