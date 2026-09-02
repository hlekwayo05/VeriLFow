'use strict';

const router = require('express').Router();
const pool = require('../db');
const authenticate = require('../middleware/authenticate');
const requireRole = require('../middleware/requireRole');
const { messageLimiter, broadcastLimiter } = require('../middleware/rateLimiter');

function initials(first, surname) {
  const a = (first || '').trim().charAt(0);
  const b = (surname || '').trim().charAt(0);
  return (a + b).toUpperCase() || '?';
}

async function lecturerOwnsModule(lecturerId, moduleCode) {
  const r = await pool.query(
    `SELECT 1 FROM lecturer_modules
     WHERE lecturer_id = $1 AND module_code = $2`,
    [lecturerId, moduleCode]
  );
  return r.rows.length > 0;
}

async function tutorLinkedToLecturer(tutorId, lecturerId, moduleCode) {
  const r = await pool.query(
    `SELECT 1
     FROM applications a
     WHERE a.user_id = $1
       AND a.status = 'approved'
       AND a.assigned_lecturer_id = $2
       AND EXISTS (
         SELECT 1 FROM lecturer_modules lm
         WHERE lm.lecturer_id = $2
           AND lm.module_code = $3
           AND (
             lm.module_name = a.module_name
             OR (a.module_code IS NOT NULL AND lm.module_code = a.module_code)
           )
       )`,
    [tutorId, lecturerId, moduleCode]
  );
  return r.rows.length > 0;
}

async function getTutorAssignedLecturer(tutorId, moduleCode) {
  const r = await pool.query(
    `SELECT u.id, u.first_names, u.surname, u.role
     FROM applications a
     JOIN users u ON u.id = a.assigned_lecturer_id
     WHERE a.user_id = $1
       AND a.status = 'approved'
       AND a.assigned_lecturer_id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM lecturer_modules lm
         WHERE lm.lecturer_id = a.assigned_lecturer_id
           AND lm.module_code = $2
           AND (
             lm.module_name = a.module_name
             OR (a.module_code IS NOT NULL AND lm.module_code = a.module_code)
           )
       )
     LIMIT 1`,
    [tutorId, moduleCode]
  );
  return r.rows[0] || null;
}

async function listLecturerModuleTutors(lecturerId, moduleCode) {
  const r = await pool.query(
    `SELECT u.id, u.first_names, u.surname, u.role, a.position_type
     FROM users u
     JOIN applications a ON a.user_id = u.id
     WHERE u.role = 'tutor'
       AND a.status = 'approved'
       AND a.assigned_lecturer_id = $1
       AND EXISTS (
         SELECT 1 FROM lecturer_modules lm
         WHERE lm.lecturer_id = $1
           AND lm.module_code = $2
           AND (
             lm.module_name = a.module_name
             OR (a.module_code IS NOT NULL AND lm.module_code = a.module_code)
           )
       )
     ORDER BY u.surname ASC, u.first_names ASC`,
    [lecturerId, moduleCode]
  );
  return r.rows;
}

function mapPeerContact(row, defaultType) {
  let type = defaultType;
  if (defaultType === 'tutor') {
    type = row?.position_type === 'demonstrator' ? 'demonstrator' : 'tutor';
  }
  return {
    type,
    id: row?.id || null,
    firstNames: row?.first_names || null,
    surname: row?.surname || null,
    name: row ? `${row.first_names || ''} ${row.surname || ''}`.trim() : null,
    initials: row ? initials(row.first_names, row.surname) : null,
    positionType: row?.position_type || null,
  };
}

router.get(
  '/peers',
  authenticate,
  requireRole('tutor', 'lecturer'),
  async (req, res) => {
    const { userId, role } = req.user;
    const moduleCode = req.query.moduleCode
      ? String(req.query.moduleCode).trim().toUpperCase()
      : null;

    try {
      const peers = [
        {
          type: 'admin',
          id: null,
          firstNames: null,
          surname: null,
          name: 'Admin',
          initials: 'AD',
        },
      ];

      if (role === 'tutor') {
        if (!moduleCode) {
          return res.status(400).json({ errors: ['Module code is required.'] });
        }
        const lecturer = await getTutorAssignedLecturer(userId, moduleCode);
        if (lecturer) {
          peers.push(mapPeerContact(lecturer, 'lecturer'));
        }
        return res.status(200).json({ peers });
      }

      // lecturer → their tutors on this module
      if (!moduleCode) {
        return res.status(400).json({ errors: ['Module code is required.'] });
      }
      if (!(await lecturerOwnsModule(userId, moduleCode))) {
        return res.status(403).json({ errors: ['You do not teach this module.'] });
      }
      const tutors = await listLecturerModuleTutors(userId, moduleCode);
      tutors.forEach((t) => peers.push(mapPeerContact(t, 'tutor')));
      return res.status(200).json({ peers });
    } catch (err) {
      console.error('Get message peers error:', err.message);
      return res.status(500).json({ error: 'Server error.' });
    }
  }
);

const COORDINATOR_PEER_NAME = 'Student Employment Office';

function parseThreadKind(req) {
  const raw = req.query.threadKind || req.body?.threadKind;
  return raw === 'coordinator' ? 'coordinator' : 'peer';
}

async function getOrCreateCoordinatorThread(peerId) {
  const existing = await pool.query(
    'SELECT id FROM coordinator_threads WHERE peer_id = $1',
    [peerId]
  );
  if (existing.rows.length) return existing.rows[0].id;

  const inserted = await pool.query(
    'INSERT INTO coordinator_threads (peer_id) VALUES ($1) RETURNING id',
    [peerId]
  );
  return inserted.rows[0].id;
}

async function validateCoordinatorRecipient(recipientId) {
  const userR = await pool.query(
    `SELECT id, role FROM users WHERE id = $1 AND role IN ('tutor', 'lecturer')`,
    [recipientId]
  );
  if (!userR.rows.length) {
    return { error: 'Recipient not found.', status: 404 };
  }
  return { peerId: userR.rows[0].id, peerRole: userR.rows[0].role };
}

async function userCanAccessCoordinatorThread(userId, role, threadId) {
  const r = await pool.query(
    'SELECT id, peer_id FROM coordinator_threads WHERE id = $1',
    [threadId]
  );
  if (!r.rows.length) return null;
  const t = r.rows[0];
  if (role === 'admin') return t;
  if (t.peer_id === userId) return t;
  return null;
}

function mapCoordinatorThreadRow(row, viewerRole) {
  const unread = Number(row.unread_count || 0) > 0;
  if (viewerRole === 'admin') {
    return {
      id: row.id,
      threadKind: 'coordinator',
      moduleCode: '',
      peerId: row.peer_id,
      peerName: `${row.peer_first_names} ${row.peer_surname}`.trim(),
      peerRole: row.peer_role,
      peerInitials: initials(row.peer_first_names, row.peer_surname),
      subject: row.last_subject || 'Message from Student Employment Office',
      preview: row.last_body || '',
      lastMessageAt: row.last_message_at,
      unreadCount: Number(row.unread_count || 0),
      unread,
    };
  }
  return {
    id: row.id,
    threadKind: 'coordinator',
    moduleCode: '',
    peerId: null,
    peerName: COORDINATOR_PEER_NAME,
    peerRole: 'admin',
    peerInitials: 'SE',
    subject: row.last_subject || 'Message from Student Employment Office',
    preview: row.last_body || '',
    lastMessageAt: row.last_message_at,
    unreadCount: Number(row.unread_count || 0),
    unread,
  };
}

async function listCoordinatorThreads(userId, role) {
  let query = `
    SELECT
      ct.id,
      ct.peer_id,
      ct.last_message_at,
      u.first_names AS peer_first_names,
      u.surname     AS peer_surname,
      u.role        AS peer_role,
      lm.subject    AS last_subject,
      lm.body       AS last_body,
      COALESCE(unread.cnt, 0) AS unread_count
    FROM coordinator_threads ct
    JOIN users u ON u.id = ct.peer_id
    LEFT JOIN LATERAL (
      SELECT subject, body
      FROM coordinator_messages
      WHERE thread_id = ct.id
      ORDER BY created_at DESC
      LIMIT 1
    ) lm ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS cnt
      FROM coordinator_messages m
      LEFT JOIN coordinator_thread_reads r
        ON r.thread_id = ct.id AND r.user_id = $1
      WHERE m.thread_id = ct.id
        AND m.sender_id <> $1
        AND m.created_at > COALESCE(r.last_read_at, '1970-01-01'::timestamptz)
    ) unread ON TRUE
    WHERE 1=1`;

  const params = [userId];
  if (role !== 'admin') {
    params.push(userId);
    query += ` AND ct.peer_id = $${params.length}`;
  }
  query += ' ORDER BY ct.last_message_at DESC';

  const result = await pool.query(query, params);
  return result.rows.map((row) => mapCoordinatorThreadRow(row, role));
}

async function getCoordinatorUnreadCount(userId, role) {
  let query = `
    SELECT COUNT(*)::int AS cnt
    FROM coordinator_messages m
    JOIN coordinator_threads ct ON ct.id = m.thread_id
    LEFT JOIN coordinator_thread_reads r
      ON r.thread_id = ct.id AND r.user_id = $1
    WHERE m.sender_id <> $1
      AND m.created_at > COALESCE(r.last_read_at, '1970-01-01'::timestamptz)`;

  const params = [userId];
  if (role !== 'admin') {
    params.push(userId);
    query += ` AND ct.peer_id = $${params.length}`;
  }

  const result = await pool.query(query, params);
  return result.rows[0].cnt;
}

async function getOrCreateThread(lecturerId, tutorId, moduleCode) {
  const existing = await pool.query(
    `SELECT id FROM message_threads
     WHERE lecturer_id = $1 AND tutor_id = $2 AND module_code = $3`,
    [lecturerId, tutorId, moduleCode]
  );
  if (existing.rows.length) return existing.rows[0].id;

  const inserted = await pool.query(
    `INSERT INTO message_threads (lecturer_id, tutor_id, module_code)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [lecturerId, tutorId, moduleCode]
  );
  return inserted.rows[0].id;
}

async function userCanAccessThread(userId, role, threadId) {
  const r = await pool.query(
    `SELECT id, lecturer_id, tutor_id, module_code
     FROM message_threads WHERE id = $1`,
    [threadId]
  );
  if (!r.rows.length) return null;
  const t = r.rows[0];
  if (role === 'lecturer' && t.lecturer_id === userId) return t;
  if (role === 'tutor' && t.tutor_id === userId) return t;
  return null;
}

function mapThreadRow(row, userId) {
  const isLecturer = row.lecturer_id === userId;
  const peerFirst = isLecturer ? row.tutor_first_names : row.lecturer_first_names;
  const peerSurname = isLecturer ? row.tutor_surname : row.lecturer_surname;
  const peerRole = isLecturer ? 'tutor' : 'lecturer';
  const unread = Number(row.unread_count || 0) > 0;

  return {
    id: row.id,
    threadKind: 'peer',
    moduleCode: row.module_code,
    peerId: isLecturer ? row.tutor_id : row.lecturer_id,
    peerName: `${peerFirst} ${peerSurname}`.trim(),
    peerRole,
    peerInitials: initials(peerFirst, peerSurname),
    subject: row.last_subject || 'Conversation',
    preview: row.last_body || '',
    lastMessageAt: row.last_message_at,
    unreadCount: Number(row.unread_count || 0),
    unread,
  };
}

router.get(
  '/threads',
  authenticate,
  requireRole('lecturer', 'tutor', 'admin'),
  async (req, res) => {
    const { userId, role } = req.user;
    const moduleCode = req.query.moduleCode
      ? String(req.query.moduleCode).trim().toUpperCase()
      : null;

    try {
      if (role === 'admin') {
        const coordinator = await listCoordinatorThreads(userId, role);
        return res.status(200).json(coordinator);
      }

      let query = `
        SELECT
          mt.id,
          mt.lecturer_id,
          mt.tutor_id,
          mt.module_code,
          mt.last_message_at,
          lec.first_names AS lecturer_first_names,
          lec.surname     AS lecturer_surname,
          tut.first_names AS tutor_first_names,
          tut.surname     AS tutor_surname,
          lm.subject      AS last_subject,
          lm.body         AS last_body,
          COALESCE(unread.cnt, 0) AS unread_count
        FROM message_threads mt
        JOIN users lec ON lec.id = mt.lecturer_id
        JOIN users tut ON tut.id = mt.tutor_id
        LEFT JOIN LATERAL (
          SELECT subject, body
          FROM messages m
          JOIN users su ON su.id = m.sender_id
          WHERE m.thread_id = mt.id
            AND su.role <> 'admin'
          ORDER BY m.created_at DESC
          LIMIT 1
        ) lm ON TRUE
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS cnt
          FROM messages m
          JOIN users su ON su.id = m.sender_id
          LEFT JOIN message_thread_reads r
            ON r.thread_id = mt.id AND r.user_id = $1
          WHERE m.thread_id = mt.id
            AND m.sender_id <> $1
            AND su.role <> 'admin'
            AND m.created_at > COALESCE(r.last_read_at, '1970-01-01'::timestamptz)
        ) unread ON TRUE
        WHERE 1=1`;

      const params = [userId];

      if (role === 'lecturer') {
        params.push(userId);
        query += ` AND mt.lecturer_id = $${params.length}`;
      } else if (role === 'tutor') {
        params.push(userId);
        query += ` AND mt.tutor_id = $${params.length}`;
      }

      if (moduleCode) {
        params.push(moduleCode);
        query += ` AND mt.module_code = $${params.length}`;
      }

      query += ' ORDER BY mt.last_message_at DESC';

      const result = await pool.query(query, params);
      const peerThreads = result.rows.map((row) => mapThreadRow(row, userId));
      const coordinator = await listCoordinatorThreads(userId, role);
      const combined = [...peerThreads, ...coordinator].sort((a, b) => {
        const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
        const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
        return bt - at;
      });
      return res.status(200).json(combined);
    } catch (err) {
      console.error('List message threads error:', err.message);
      return res.status(500).json({ error: 'Server error.' });
    }
  }
);

router.get(
  '/unread-count',
  authenticate,
  requireRole('lecturer', 'tutor', 'admin'),
  async (req, res) => {
    const { userId, role } = req.user;
    const moduleCode = req.query.moduleCode
      ? String(req.query.moduleCode).trim().toUpperCase()
      : null;

    try {
      if (role === 'admin') {
        const count = await getCoordinatorUnreadCount(userId, role);
        return res.status(200).json({ count });
      }

      let query = `
        SELECT COUNT(*)::int AS cnt
        FROM messages m
        JOIN message_threads mt ON mt.id = m.thread_id
        JOIN users su ON su.id = m.sender_id
        LEFT JOIN message_thread_reads r
          ON r.thread_id = mt.id AND r.user_id = $1
        WHERE m.sender_id <> $1
          AND su.role <> 'admin'
          AND m.created_at > COALESCE(r.last_read_at, '1970-01-01'::timestamptz)`;

      const params = [userId];

      if (role === 'lecturer') {
        params.push(userId);
        query += ` AND mt.lecturer_id = $${params.length}`;
      } else if (role === 'tutor') {
        params.push(userId);
        query += ` AND mt.tutor_id = $${params.length}`;
      }

      if (moduleCode) {
        params.push(moduleCode);
        query += ` AND mt.module_code = $${params.length}`;
      }

      const result = await pool.query(query, params);
      const peerCount = result.rows[0].cnt;
      const coordCount = await getCoordinatorUnreadCount(userId, role);
      return res.status(200).json({ count: peerCount + coordCount });
    } catch (err) {
      console.error('Unread count error:', err.message);
      return res.status(500).json({ error: 'Server error.' });
    }
  }
);

router.get(
  '/threads/:id',
  authenticate,
  requireRole('lecturer', 'tutor', 'admin'),
  async (req, res) => {
    const threadId = parseInt(req.params.id, 10);
    const { userId, role } = req.user;
    const threadKind = parseThreadKind(req);
    if (!threadId) return res.status(400).json({ errors: ['Invalid thread id.'] });

    try {
      if (threadKind === 'coordinator' || role === 'admin') {
        const thread = await userCanAccessCoordinatorThread(userId, role, threadId);
        if (!thread) return res.status(404).json({ errors: ['Thread not found.'] });

        const meta = await pool.query(
          `SELECT ct.*, u.first_names AS peer_first_names, u.surname AS peer_surname, u.role AS peer_role
           FROM coordinator_threads ct
           JOIN users u ON u.id = ct.peer_id
           WHERE ct.id = $1`,
          [threadId]
        );

        const msgs = await pool.query(
          `SELECT m.id, m.sender_id, m.subject, m.body, m.created_at,
                  u.first_names, u.surname, u.role
           FROM coordinator_messages m
           JOIN users u ON u.id = m.sender_id
           WHERE m.thread_id = $1
           ORDER BY m.created_at ASC`,
          [threadId]
        );

        await pool.query(
          `INSERT INTO coordinator_thread_reads (thread_id, user_id, last_read_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (thread_id, user_id)
           DO UPDATE SET last_read_at = NOW()`,
          [threadId, userId]
        );

        const row = meta.rows[0];
        const summary = mapCoordinatorThreadRow({
          id: row.id,
          peer_id: row.peer_id,
          last_message_at: row.last_message_at,
          peer_first_names: row.peer_first_names,
          peer_surname: row.peer_surname,
          peer_role: row.peer_role,
          last_subject: msgs.rows.length
            ? msgs.rows[msgs.rows.length - 1].subject
            : null,
          last_body: msgs.rows.length
            ? msgs.rows[msgs.rows.length - 1].body
            : null,
          unread_count: 0,
        }, role);

        return res.status(200).json({
          ...summary,
          messages: msgs.rows.map((m) => ({
            id: m.id,
            senderId: m.sender_id,
            senderName: m.role === 'admin'
              ? COORDINATOR_PEER_NAME
              : `${m.first_names} ${m.surname}`.trim(),
            senderRole: m.role,
            subject: m.subject,
            body: m.body,
            createdAt: m.created_at,
            isMine: m.sender_id === userId,
          })),
        });
      }

      if (role === 'admin') {
        return res.status(404).json({ errors: ['Thread not found.'] });
      }

      const thread = await userCanAccessThread(userId, role, threadId);
      if (!thread) return res.status(404).json({ errors: ['Thread not found.'] });

      const meta = await pool.query(
        `SELECT
           mt.*,
           lec.first_names AS lecturer_first_names,
           lec.surname     AS lecturer_surname,
           tut.first_names AS tutor_first_names,
           tut.surname     AS tutor_surname
         FROM message_threads mt
         JOIN users lec ON lec.id = mt.lecturer_id
         JOIN users tut ON tut.id = mt.tutor_id
         WHERE mt.id = $1`,
        [threadId]
      );

      const msgs = await pool.query(
        `SELECT m.id, m.sender_id, m.subject, m.body, m.created_at,
                u.first_names, u.surname, u.role
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         WHERE m.thread_id = $1
           AND u.role <> 'admin'
         ORDER BY m.created_at ASC`,
        [threadId]
      );

      await pool.query(
        `INSERT INTO message_thread_reads (thread_id, user_id, last_read_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (thread_id, user_id)
         DO UPDATE SET last_read_at = NOW()`,
        [threadId, userId]
      );

      const row = meta.rows[0];
      const isLecturer = row.lecturer_id === userId;
      const peerFirst = isLecturer ? row.tutor_first_names : row.lecturer_first_names;
      const peerSurname = isLecturer ? row.tutor_surname : row.lecturer_surname;

      return res.status(200).json({
        id: row.id,
        threadKind: 'peer',
        moduleCode: row.module_code,
        peerId: isLecturer ? row.tutor_id : row.lecturer_id,
        peerName: `${peerFirst} ${peerSurname}`.trim(),
        peerRole: isLecturer ? 'tutor' : 'lecturer',
        peerInitials: initials(peerFirst, peerSurname),
        messages: msgs.rows.map((m) => ({
          id: m.id,
          senderId: m.sender_id,
          senderName: `${m.first_names} ${m.surname}`.trim(),
          senderRole: m.role,
          subject: m.subject,
          body: m.body,
          createdAt: m.created_at,
          isMine: m.sender_id === userId,
        })),
      });
    } catch (err) {
      console.error('Get message thread error:', err.message);
      return res.status(500).json({ error: 'Server error.' });
    }
  }
);

router.post(
  '/threads',
  messageLimiter,
  authenticate,
  requireRole('lecturer', 'tutor', 'admin'),
  async (req, res) => {
    const { userId, role } = req.user;
    let moduleCode = req.body.moduleCode
      ? String(req.body.moduleCode).trim().toUpperCase()
      : null;
    const subject = req.body.subject ? String(req.body.subject).trim().slice(0, 255) : null;
    const body = req.body.body
      ? String(req.body.body).trim()
      : (req.body.message ? String(req.body.message).trim() : '');
    const recipientId = req.body.recipientId ? parseInt(req.body.recipientId, 10) : null;

    if (!body) return res.status(400).json({ errors: ['Message body is required.'] });

    try {
      if (role === 'admin') {
        if (!recipientId) {
          return res.status(400).json({ errors: ['Recipient is required.'] });
        }
        const validated = await validateCoordinatorRecipient(recipientId);
        if (validated.error) {
          return res.status(validated.status).json({ errors: [validated.error] });
        }
        const coordThreadId = await getOrCreateCoordinatorThread(validated.peerId);
        const inserted = await pool.query(
          `INSERT INTO coordinator_messages (thread_id, sender_id, subject, body)
           VALUES ($1, $2, $3, $4)
           RETURNING id, created_at`,
          [coordThreadId, userId, subject, body]
        );
        await pool.query(
          `UPDATE coordinator_threads
           SET updated_at = NOW(), last_message_at = NOW()
           WHERE id = $1`,
          [coordThreadId]
        );
        return res.status(201).json({
          threadId: coordThreadId,
          threadKind: 'coordinator',
          messageId: inserted.rows[0].id,
          createdAt: inserted.rows[0].created_at,
        });
      }

      // Tutor or lecturer → admin (Student Employment Office)
      if (
        (role === 'tutor' || role === 'lecturer') &&
        (req.body.threadKind === 'coordinator' || req.body.toAdmin === true)
      ) {
        const coordThreadId = await getOrCreateCoordinatorThread(userId);
        const inserted = await pool.query(
          `INSERT INTO coordinator_messages (thread_id, sender_id, subject, body)
           VALUES ($1, $2, $3, $4)
           RETURNING id, created_at`,
          [coordThreadId, userId, subject, body]
        );
        await pool.query(
          `UPDATE coordinator_threads
           SET updated_at = NOW(), last_message_at = NOW()
           WHERE id = $1`,
          [coordThreadId]
        );
        return res.status(201).json({
          threadId: coordThreadId,
          threadKind: 'coordinator',
          messageId: inserted.rows[0].id,
          createdAt: inserted.rows[0].created_at,
        });
      }

      if (!moduleCode) return res.status(400).json({ errors: ['Module code is required.'] });

      let lecturerId;
      let tutorId;

      if (role === 'lecturer') {
        lecturerId = userId;
        if (!recipientId) return res.status(400).json({ errors: ['Recipient tutor is required.'] });
        if (!(await lecturerOwnsModule(lecturerId, moduleCode))) {
          return res.status(403).json({ errors: ['You do not teach this module.'] });
        }
        if (!(await tutorLinkedToLecturer(recipientId, lecturerId, moduleCode))) {
          return res.status(403).json({ errors: ['This tutor is not on your module.'] });
        }
        tutorId = recipientId;
      } else {
        tutorId = userId;
        const lecturer = await getTutorAssignedLecturer(tutorId, moduleCode);
        if (!lecturer) {
          return res.status(403).json({ errors: ['No lecturer is linked to this module for you.'] });
        }
        lecturerId = lecturer.id;
      }

      const threadId = await getOrCreateThread(lecturerId, tutorId, moduleCode);

      const inserted = await pool.query(
        `INSERT INTO messages (thread_id, sender_id, subject, body)
         VALUES ($1, $2, $3, $4)
         RETURNING id, created_at`,
        [threadId, userId, subject, body]
      );

      await pool.query(
        `UPDATE message_threads
         SET updated_at = NOW(), last_message_at = NOW()
         WHERE id = $1`,
        [threadId]
      );

      return res.status(201).json({
        threadId,
        threadKind: 'peer',
        messageId: inserted.rows[0].id,
        createdAt: inserted.rows[0].created_at,
      });
    } catch (err) {
      console.error('Create message thread error:', err.message);
      return res.status(500).json({ error: 'Server error.' });
    }
  }
);

router.post(
  '/threads/:id/messages',
  messageLimiter,
  authenticate,
  requireRole('lecturer', 'tutor', 'admin'),
  async (req, res) => {
    const threadId = parseInt(req.params.id, 10);
    const { userId, role } = req.user;
    const threadKind = parseThreadKind(req);
    const body = req.body.body ? String(req.body.body).trim() : '';

    if (!threadId) return res.status(400).json({ errors: ['Invalid thread id.'] });
    if (!body) return res.status(400).json({ errors: ['Message body is required.'] });

    try {
      if (threadKind === 'coordinator' || role === 'admin') {
        const thread = await userCanAccessCoordinatorThread(userId, role, threadId);
        if (!thread) return res.status(404).json({ errors: ['Thread not found.'] });

        const inserted = await pool.query(
          `INSERT INTO coordinator_messages (thread_id, sender_id, body)
           VALUES ($1, $2, $3)
           RETURNING id, created_at`,
          [threadId, userId, body]
        );

        await pool.query(
          `UPDATE coordinator_threads
           SET updated_at = NOW(), last_message_at = NOW()
           WHERE id = $1`,
          [threadId]
        );

        return res.status(201).json({
          messageId: inserted.rows[0].id,
          createdAt: inserted.rows[0].created_at,
        });
      }

      if (role === 'admin') {
        return res.status(403).json({ errors: ['Thread not found.'] });
      }

      const thread = await userCanAccessThread(userId, role, threadId);
      if (!thread) return res.status(404).json({ errors: ['Thread not found.'] });

      const inserted = await pool.query(
        `INSERT INTO messages (thread_id, sender_id, body)
         VALUES ($1, $2, $3)
         RETURNING id, created_at`,
        [threadId, userId, body]
      );

      await pool.query(
        `UPDATE message_threads
         SET updated_at = NOW(), last_message_at = NOW()
         WHERE id = $1`,
        [threadId]
      );

      return res.status(201).json({
        messageId: inserted.rows[0].id,
        createdAt: inserted.rows[0].created_at,
      });
    } catch (err) {
      console.error('Reply message error:', err.message);
      return res.status(500).json({ error: 'Server error.' });
    }
  }
);

router.post(
  '/broadcast',
  broadcastLimiter,
  authenticate,
  requireRole('lecturer'),
  async (req, res) => {
    const { userId } = req.user;
    const moduleCode = req.body.moduleCode
      ? String(req.body.moduleCode).trim().toUpperCase()
      : null;
    const subject = req.body.subject ? String(req.body.subject).trim().slice(0, 255) : null;
    const body = req.body.body ? String(req.body.body).trim() : '';

    if (!moduleCode) return res.status(400).json({ errors: ['Module code is required.'] });
    if (!body) return res.status(400).json({ errors: ['Message body is required.'] });

    try {
      if (!(await lecturerOwnsModule(userId, moduleCode))) {
        return res.status(403).json({ errors: ['You do not teach this module.'] });
      }

      const tutors = await listLecturerModuleTutors(userId, moduleCode);

      if (!tutors.length) {
        return res.status(400).json({ errors: ['No tutors on this module to message.'] });
      }

      let sent = 0;
      for (const row of tutors) {
        const threadId = await getOrCreateThread(userId, row.id, moduleCode);
        await pool.query(
          `INSERT INTO messages (thread_id, sender_id, subject, body)
           VALUES ($1, $2, $3, $4)`,
          [threadId, userId, subject, body]
        );
        await pool.query(
          `UPDATE message_threads SET updated_at = NOW(), last_message_at = NOW() WHERE id = $1`,
          [threadId]
        );
        sent += 1;
      }

      return res.status(201).json({ sent, message: `Message sent to ${sent} tutor(s).` });
    } catch (err) {
      console.error('Broadcast message error:', err.message);
      return res.status(500).json({ error: 'Server error.' });
    }
  }
);

module.exports = router;
