-- =============================================================
--  VeriFlow - Seed Script (admin only)
-- =============================================================
-- Prefer:  node seed.js
-- That script bcrypt-hashes the password and removes old demo
-- accounts (fye / smahlangu / cnkosi / tdlamini / bmasondo).
--
-- This SQL file is kept as a minimal reference. Do not insert
-- placeholder hashes for login - use seed.js.
-- =============================================================

-- Remove legacy demo accounts (dependents must be cleared first if
-- you run this by hand; seed.js handles FK order correctly).

-- Admin account is created/updated by:
--   node seed.js
-- Email: veriflow@ump.ac.za
