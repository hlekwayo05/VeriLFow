-- HR package documents on applications (apply step 3)
ALTER TABLE applications ADD COLUMN IF NOT EXISTS id_copy_filename VARCHAR(255);
ALTER TABLE applications ADD COLUMN IF NOT EXISTS id_copy_original_name VARCHAR(255);
ALTER TABLE applications ADD COLUMN IF NOT EXISTS tax_proof_filename VARCHAR(255);
ALTER TABLE applications ADD COLUMN IF NOT EXISTS tax_proof_original_name VARCHAR(255);
ALTER TABLE applications ADD COLUMN IF NOT EXISTS bank_proof_filename VARCHAR(255);
ALTER TABLE applications ADD COLUMN IF NOT EXISTS bank_proof_original_name VARCHAR(255);

-- Appointment period + director for Form D / Confirmation Form signatures
ALTER TABLE settings ADD COLUMN IF NOT EXISTS appointment_period_start DATE;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS appointment_period_end DATE;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS director_name VARCHAR(200);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS director_title VARCHAR(200) DEFAULT 'Director: Student Affairs';
