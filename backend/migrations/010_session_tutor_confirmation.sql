-- Migration 010: tutor availability confirmation on session assignments

ALTER TABLE session_tutors
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS declined_at  TIMESTAMPTZ;
