-- =============================================================
-- 019: Performance — indexes, attendance_logs hash partitioning
-- Safe / idempotent. Run via: npm run db:migrate-pending
-- =============================================================

-- ── Indexes for hot lecturer / admin list queries ─────────────

CREATE INDEX IF NOT EXISTS idx_applications_assigned_lecturer
  ON applications (assigned_lecturer_id)
  WHERE assigned_lecturer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_applications_status_lecturer
  ON applications (status, assigned_lecturer_id)
  WHERE assigned_lecturer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_lecturer_module_date
  ON sessions (lecturer_id, module_code, session_date DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_status_date
  ON sessions (status, session_date DESC);

CREATE INDEX IF NOT EXISTS idx_claims_lecturer_module_status
  ON claims (lecturer_id, module_code, status);

CREATE INDEX IF NOT EXISTS idx_claims_submitted_at
  ON claims (submitted_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_referrals_lecturer_module
  ON referrals (lecturer_id, module_code);

CREATE INDEX IF NOT EXISTS idx_attendance_recorded_at
  ON attendance_logs (recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_student
  ON attendance_logs (student_number);

CREATE INDEX IF NOT EXISTS idx_session_tutors_session
  ON session_tutors (session_id);

-- ── Hash-partition attendance_logs by session_id ─────────────
-- Spreads check-in writes across partitions. UNIQUE (session_id,
-- student_number) is preserved because session_id is the partition key.

DO $$
DECLARE
  relkind char;
  part_count int;
BEGIN
  SELECT c.relkind INTO relkind
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'attendance_logs';

  IF relkind IS NULL THEN
    RAISE NOTICE 'attendance_logs missing — skip partitioning';
    RETURN;
  END IF;

  IF relkind = 'p' THEN
    RAISE NOTICE 'attendance_logs already partitioned';
    RETURN;
  END IF;

  CREATE TABLE attendance_logs_part (
    id              BIGSERIAL,
    session_id      INT          NOT NULL,
    student_number  VARCHAR(20)  NOT NULL,
    recorded_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, session_id),
    UNIQUE (session_id, student_number),
    CONSTRAINT attendance_logs_part_session_fk
      FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
  ) PARTITION BY HASH (session_id);

  FOR part_count IN 0..7 LOOP
    EXECUTE format(
      'CREATE TABLE attendance_logs_p%s PARTITION OF attendance_logs_part
       FOR VALUES WITH (MODULUS 8, REMAINDER %s)',
      part_count, part_count
    );
  END LOOP;

  INSERT INTO attendance_logs_part (id, session_id, student_number, recorded_at)
  SELECT id, session_id, student_number, recorded_at FROM attendance_logs;

  PERFORM setval(
    pg_get_serial_sequence('attendance_logs_part', 'id'),
    COALESCE((SELECT MAX(id) FROM attendance_logs_part), 1),
    true
  );

  ALTER TABLE attendance_logs RENAME TO attendance_logs_legacy;
  ALTER TABLE attendance_logs_part RENAME TO attendance_logs;

  CREATE INDEX IF NOT EXISTS idx_attendance_session ON attendance_logs (session_id);
  CREATE INDEX IF NOT EXISTS idx_attendance_recorded_at ON attendance_logs (recorded_at DESC);
  CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance_logs (student_number);

  DROP TABLE attendance_logs_legacy;

  RAISE NOTICE 'attendance_logs converted to 8-way HASH partitions on session_id';
END $$;
