ALTER TABLE applications ADD COLUMN IF NOT EXISTS position_type VARCHAR(20) DEFAULT 'tutor'
  CHECK (position_type IN ('tutor', 'demonstrator'));

ALTER TABLE applications ADD COLUMN IF NOT EXISTS cost_centre VARCHAR(50);

UPDATE applications SET position_type = 'tutor' WHERE position_type IS NULL;
