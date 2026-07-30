'use strict';

const router       = require('express').Router();
const pool         = require('../db');
const authenticate = require('../middleware/authenticate');
const requireRole  = require('../middleware/requireRole');
const { supportLimiter } = require('../middleware/rateLimiter');

function mapListRow(row) {
  return {
    id:               row.id,
    subject:          row.subject,
    details:          row.details,
    priority:         row.priority,
    status:           row.status,
    created_at:       row.created_at,
    resolved_at:      row.resolved_at,
    created_by_name:  row.created_by_name,
    created_by_role:  row.created_by_role,
    reply_count:      Number(row.reply_count) || 0,
    latest_reply_at:  row.latest_reply_at,
  };
}

async function fetchTicketForUser(ticketId, userId, role) {
  const result = await pool.query(
    `SELECT t.*,
            TRIM(CONCAT(u.first_names, ' ', u.surname)) AS created_by_name
     FROM support_tickets t
     JOIN users u ON u.id = t.created_by_id
     WHERE t.id = $1`,
    [ticketId]
  );
  if (!result.rows.length) return null;
  const ticket = result.rows[0];
  if (role !== 'admin' && ticket.created_by_id !== userId) {
    return { forbidden: true };
  }
  return ticket;
}

async function fetchTicketReplies(ticketId) {
  const result = await pool.query(
    `SELECT r.id, r.message, r.created_at, r.author_role,
            TRIM(CONCAT(u.first_names, ' ', u.surname)) AS author_name
     FROM support_ticket_replies r
     JOIN users u ON u.id = r.author_id
     WHERE r.ticket_id = $1
     ORDER BY r.created_at ASC`,
    [ticketId]
  );
  return result.rows;
}

router.get(
  '/tickets',
  authenticate,
  requireRole('admin', 'tutor', 'lecturer'),
  async (req, res) => {
    const { userId, role } = req.user;

    try {
      const params = [];
      let where = 'WHERE 1=1';
      if (role !== 'admin') {
        params.push(userId);
        where += ` AND t.created_by_id = $${params.length}`;
      }

      const result = await pool.query(
        `SELECT
           t.id,
           t.subject,
           t.details,
           t.priority,
           t.status,
           t.created_at,
           t.resolved_at,
           t.created_by_role,
           TRIM(CONCAT(u.first_names, ' ', u.surname)) AS created_by_name,
           COUNT(r.id) AS reply_count,
           MAX(r.created_at) AS latest_reply_at
         FROM support_tickets t
         JOIN users u ON u.id = t.created_by_id
         LEFT JOIN support_ticket_replies r ON r.ticket_id = t.id
         ${where}
         GROUP BY t.id, u.first_names, u.surname
         ORDER BY t.created_at DESC`,
        params
      );

      return res.status(200).json(result.rows.map(mapListRow));
    } catch (err) {
      console.error('List support tickets error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);

router.post(
  '/tickets',
  supportLimiter,
  authenticate,
  requireRole('tutor', 'lecturer'),
  async (req, res) => {
    const { subject, details, priority } = req.body;
    const errors = [];

    if (!subject || !String(subject).trim()) {
      errors.push('Subject is required.');
    }
    if (!details || !String(details).trim()) {
      errors.push('Details are required.');
    }

    const prio = (priority || 'medium').toLowerCase();
    if (!['low', 'medium', 'high'].includes(prio)) {
      errors.push("Priority must be 'low', 'medium', or 'high'.");
    }

    if (errors.length) return res.status(400).json({ errors });

    try {
      const result = await pool.query(
        `INSERT INTO support_tickets
           (created_by_id, created_by_role, subject, details, priority, status)
         VALUES ($1, $2, $3, $4, $5, 'open')
         RETURNING id, subject, details, priority, status, created_at, resolved_at, created_by_role`,
        [
          req.user.userId,
          req.user.role,
          String(subject).trim(),
          String(details).trim(),
          prio,
        ]
      );

      const userResult = await pool.query(
        `SELECT TRIM(CONCAT(first_names, ' ', surname)) AS created_by_name
         FROM users WHERE id = $1`,
        [req.user.userId]
      );

      const row = result.rows[0];
      return res.status(201).json({
        ...mapListRow({
          ...row,
          created_by_name: userResult.rows[0]?.created_by_name || '',
          reply_count: 0,
          latest_reply_at: null,
        }),
      });
    } catch (err) {
      console.error('Create support ticket error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);

router.get(
  '/tickets/:id',
  authenticate,
  requireRole('admin', 'tutor', 'lecturer'),
  async (req, res) => {
    const ticketId = parseInt(req.params.id, 10);
    if (!ticketId) return res.status(400).json({ errors: ['Invalid ticket id.'] });

    try {
      const ticket = await fetchTicketForUser(ticketId, req.user.userId, req.user.role);
      if (!ticket) return res.status(404).json({ errors: ['Ticket not found.'] });
      if (ticket.forbidden) {
        return res.status(403).json({ errors: ['You do not have access to this ticket.'] });
      }

      const replies = await fetchTicketReplies(ticketId);

      return res.status(200).json({
        id:              ticket.id,
        subject:         ticket.subject,
        details:         ticket.details,
        priority:        ticket.priority,
        status:          ticket.status,
        created_at:      ticket.created_at,
        resolved_at:     ticket.resolved_at,
        created_by_name: ticket.created_by_name,
        created_by_role: ticket.created_by_role,
        replies,
      });
    } catch (err) {
      console.error('Get support ticket error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);

router.post(
  '/tickets/:id/reply',
  supportLimiter,
  authenticate,
  requireRole('admin', 'tutor', 'lecturer'),
  async (req, res) => {
    const ticketId = parseInt(req.params.id, 10);
    const { message } = req.body;

    if (!ticketId) return res.status(400).json({ errors: ['Invalid ticket id.'] });
    if (!message || !String(message).trim()) {
      return res.status(400).json({ errors: ['Message is required.'] });
    }

    try {
      const ticket = await fetchTicketForUser(ticketId, req.user.userId, req.user.role);
      if (!ticket) return res.status(404).json({ errors: ['Ticket not found.'] });
      if (ticket.forbidden) {
        return res.status(403).json({ errors: ['You do not have access to this ticket.'] });
      }
      if (ticket.status === 'resolved') {
        return res.status(400).json({ errors: ['This ticket is already resolved.'] });
      }

      const insert = await pool.query(
        `INSERT INTO support_ticket_replies
           (ticket_id, author_id, author_role, message)
         VALUES ($1, $2, $3, $4)
         RETURNING id, message, created_at, author_role`,
        [ticketId, req.user.userId, req.user.role, String(message).trim()]
      );

      await pool.query(
        `UPDATE support_tickets SET updated_at = NOW() WHERE id = $1`,
        [ticketId]
      );

      const userResult = await pool.query(
        `SELECT TRIM(CONCAT(first_names, ' ', surname)) AS author_name
         FROM users WHERE id = $1`,
        [req.user.userId]
      );

      const reply = insert.rows[0];
      reply.author_name = userResult.rows[0]?.author_name || '';

      return res.status(201).json(reply);
    } catch (err) {
      console.error('Reply support ticket error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);

router.patch(
  '/tickets/:id/resolve',
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    const ticketId = parseInt(req.params.id, 10);
    const { note } = req.body;

    if (!ticketId) return res.status(400).json({ errors: ['Invalid ticket id.'] });

    try {
      const ticket = await fetchTicketForUser(ticketId, req.user.userId, 'admin');
      if (!ticket) return res.status(404).json({ errors: ['Ticket not found.'] });

      if (note && String(note).trim()) {
        await pool.query(
          `INSERT INTO support_ticket_replies
             (ticket_id, author_id, author_role, message)
           VALUES ($1, $2, 'admin', $3)`,
          [ticketId, req.user.userId, String(note).trim()]
        );
      }

      const result = await pool.query(
        `UPDATE support_tickets
         SET status = 'resolved', resolved_at = NOW(), updated_at = NOW()
         WHERE id = $1
         RETURNING id, subject, details, priority, status, created_at, resolved_at, created_by_role`,
        [ticketId]
      );

      const userResult = await pool.query(
        `SELECT TRIM(CONCAT(u.first_names, ' ', u.surname)) AS created_by_name
         FROM support_tickets t
         JOIN users u ON u.id = t.created_by_id
         WHERE t.id = $1`,
        [ticketId]
      );

      return res.status(200).json(mapListRow({
        ...result.rows[0],
        created_by_name: userResult.rows[0]?.created_by_name || '',
        reply_count: 0,
        latest_reply_at: null,
      }));
    } catch (err) {
      console.error('Resolve support ticket error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);

router.patch(
  '/tickets/:id/status',
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    const ticketId = parseInt(req.params.id, 10);
    const { status } = req.body;

    if (!ticketId) return res.status(400).json({ errors: ['Invalid ticket id.'] });
    if (!['open', 'in_progress'].includes(status)) {
      return res.status(400).json({ errors: ["Status must be 'open' or 'in_progress'."] });
    }

    try {
      const result = await pool.query(
        `UPDATE support_tickets
         SET status = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, subject, details, priority, status, created_at, resolved_at, created_by_role`,
        [status, ticketId]
      );

      if (!result.rows.length) {
        return res.status(404).json({ errors: ['Ticket not found.'] });
      }

      const userResult = await pool.query(
        `SELECT TRIM(CONCAT(u.first_names, ' ', u.surname)) AS created_by_name
         FROM support_tickets t
         JOIN users u ON u.id = t.created_by_id
         WHERE t.id = $1`,
        [ticketId]
      );

      return res.status(200).json(mapListRow({
        ...result.rows[0],
        created_by_name: userResult.rows[0]?.created_by_name || '',
        reply_count: 0,
        latest_reply_at: null,
      }));
    } catch (err) {
      console.error('Update support ticket status error:', err.message);
      return res.status(500).json({ errors: ['Server error.'] });
    }
  }
);

module.exports = router;
