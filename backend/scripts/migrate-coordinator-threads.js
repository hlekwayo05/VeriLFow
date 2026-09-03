'use strict';

/**
 * Coordinator (admin) messaging - separate from lecturer↔tutor peer threads.
 * Safe to run multiple times (IF NOT EXISTS).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db');

const SQL = `
CREATE TABLE IF NOT EXISTS coordinator_threads (
  id              SERIAL PRIMARY KEY,
  peer_id         INT          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (peer_id)
);

CREATE TABLE IF NOT EXISTS coordinator_messages (
  id         SERIAL PRIMARY KEY,
  thread_id  INT          NOT NULL REFERENCES coordinator_threads (id) ON DELETE CASCADE,
  sender_id  INT          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  subject    VARCHAR(255),
  body       TEXT         NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coordinator_thread_reads (
  thread_id     INT         NOT NULL REFERENCES coordinator_threads (id) ON DELETE CASCADE,
  user_id       INT         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  last_read_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (thread_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_coordinator_threads_peer
  ON coordinator_threads (peer_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_coordinator_messages_thread
  ON coordinator_messages (thread_id, created_at ASC);
`;

async function main() {
  try {
    await pool.query(SQL);
    console.log('Coordinator messaging tables ready.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
