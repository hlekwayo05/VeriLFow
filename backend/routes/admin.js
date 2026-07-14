'use strict';

const router       = require('express').Router();
const pool         = require('../db');
const authenticate = require('../middleware/authenticate');
const requireRole  = require('../middleware/requireRole');

// GET /api/admin/claims — coordinator queue
router.get(
  '/claims',
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
           c.id,
           c.module_code,
           c.period_month,
           c.period_year,
           c.total_hours,
           c.pay_rate,
           c.total_amount,
           c.status,
           c.submitted_at,
           c.lecturer_note,
           c.coordinator_note,
           ut.first_names AS tutor_first_names,
           ut.surname AS tutor_surname,
           a.qualification_level,
           a.responsibility_level,
           COUNT(cs.id)::int AS session_count
         FROM claims c
         JOIN users ut ON ut.id = c.tutor_id
         LEFT JOIN applications a ON a.user_id = c.tutor_id AND a.status = 'approved'
         LEFT JOIN claim_sessions cs ON cs.claim_id = c.id AND cs.included = true
         WHERE c.status = 'pending_coordinator'
            OR c.status = 'approved'
            OR c.status = 'returned_by_coordinator'
         GROUP BY c.id, ut.first_names, ut.surname, a.qualification_level, a.responsibility_level
         ORDER BY
           CASE c.status WHEN 'pending_coordinator' THEN 0 ELSE 1 END,
           c.submitted_at DESC NULLS LAST`
      );
      return res.status(200).json(result.rows);
    } catch (err) {
      console.error('Admin claims error:', err.message);
      return res.status(500).json({ error: 'Server error.' });
    }
  }
);

module.exports = router;
