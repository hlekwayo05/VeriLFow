-- Align legacy settings rate columns with 2026 UMP tariff baseline (low responsibility).
UPDATE settings SET
  rate_undergrad = 59.66,
  rate_honours = 73.87,
  rate_masters = 90.92
WHERE id = 1;
