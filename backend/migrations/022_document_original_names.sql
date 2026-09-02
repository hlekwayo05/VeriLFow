ALTER TABLE applications ADD COLUMN IF NOT EXISTS cv_original_name VARCHAR(255);
ALTER TABLE applications ADD COLUMN IF NOT EXISTS transcript_original_name VARCHAR(255);
