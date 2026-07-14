-- Migration 015 — Lecturer ↔ tutor messaging threads

BEGIN;

CREATE TABLE message_threads (
  id              SERIAL PRIMARY KEY,
  lecturer_id     INT          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  tutor_id        INT          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  module_code     VARCHAR(20)  NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (lecturer_id, tutor_id, module_code)
);

CREATE TABLE messages (
  id         SERIAL PRIMARY KEY,
  thread_id  INT          NOT NULL REFERENCES message_threads (id) ON DELETE CASCADE,
  sender_id  INT          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  subject    VARCHAR(255),
  body       TEXT         NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE message_thread_reads (
  thread_id     INT         NOT NULL REFERENCES message_threads (id) ON DELETE CASCADE,
  user_id       INT         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  last_read_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (thread_id, user_id)
);

CREATE INDEX idx_message_threads_lecturer ON message_threads (lecturer_id, last_message_at DESC);
CREATE INDEX idx_message_threads_tutor ON message_threads (tutor_id, last_message_at DESC);
CREATE INDEX idx_messages_thread ON messages (thread_id, created_at ASC);

COMMIT;
