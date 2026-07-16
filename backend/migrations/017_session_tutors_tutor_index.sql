-- Speed up tutor dashboard session lists (JOIN session_tutors ON tutor_id).
CREATE INDEX IF NOT EXISTS idx_session_tutors_tutor_id ON session_tutors (tutor_id);

-- Speed up claims lookup by tutor + module + period.
CREATE INDEX IF NOT EXISTS idx_claims_tutor_module_period
  ON claims (tutor_id, module_code, period_year DESC, period_month DESC);
