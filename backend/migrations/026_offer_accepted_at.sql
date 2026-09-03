-- Tutor electronic acceptance of appointment offer (VeriFlow "I accept")
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS offer_accepted_at TIMESTAMPTZ;
